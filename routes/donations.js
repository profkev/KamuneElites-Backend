const express = require('express');
const { body, validationResult } = require('express-validator');
const Donation = require('../models/Donation');
const { protect, authorize, optionalAuth } = require('../middleware/auth');
const { initiateStkPush } = require('../mpesa');

const router = express.Router();

// @desc    Get all donations (Admin only)
// @route   GET /api/donations
// @access  Private (Admin)
router.get('/', protect, authorize('admin'), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      paymentMethod,
      donationType,
      purpose,
      startDate,
      endDate,
      search
    } = req.query;

    // Build query
    const query = {};

    // Status filter
    if (status) {
      query.paymentStatus = status;
    }

    // Payment method filter
    if (paymentMethod) {
      query.paymentMethod = paymentMethod;
    }

    // Donation type filter
    if (donationType) {
      query.donationType = donationType;
    }

    // Purpose filter
    if (purpose) {
      query.purpose = purpose;
    }

    // Date range filter
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Search filter
    if (search) {
      query.$or = [
        { 'donor.firstName': { $regex: search, $options: 'i' } },
        { 'donor.lastName': { $regex: search, $options: 'i' } },
        { 'donor.email': { $regex: search, $options: 'i' } },
        { transactionId: { $regex: search, $options: 'i' } },
        { receiptNumber: { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);

    const donations = await Donation.find(query)
      .populate('processedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Donation.countDocuments(query);

    // Calculate totals
    const totalAmount = await Donation.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    res.json({
      donations,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limitNum),
        totalDonations: total,
        totalAmount: totalAmount[0]?.total || 0,
        hasNextPage: skip + limitNum < total,
        hasPrevPage: parseInt(page) > 1
      }
    });
  } catch (error) {
    console.error('Get donations error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @desc    Get donation statistics
// @route   GET /api/donations/stats
// @access  Public
router.get('/stats', async (req, res) => {
  try {
    const totalDonations = await Donation.countDocuments({ paymentStatus: 'completed' });
    const totalAmount = await Donation.aggregate([
      { $match: { paymentStatus: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    // Monthly donations for current year
    const currentYear = new Date().getFullYear();
    const monthlyStats = await Donation.aggregate([
      {
        $match: {
          paymentStatus: 'completed',
          createdAt: {
            $gte: new Date(currentYear, 0, 1),
            $lt: new Date(currentYear + 1, 0, 1)
          }
        }
      },
      {
        $group: {
          _id: { $month: '$createdAt' },
          count: { $sum: 1 },
          amount: { $sum: '$amount' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Donations by purpose
    const purposeStats = await Donation.aggregate([
      { $match: { paymentStatus: 'completed' } },
      {
        $group: {
          _id: '$purpose',
          count: { $sum: 1 },
          amount: { $sum: '$amount' }
        }
      }
    ]);

    res.json({
      totalDonations,
      totalAmount: totalAmount[0]?.total || 0,
      monthlyStats,
      purposeStats
    });
  } catch (error) {
    console.error('Get donation stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @desc    Create new donation
// @route   POST /api/donations
// @access  Public
router.post('/', [
  body('donor.firstName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  body('donor.lastName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  body('donor.email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('amount')
    .isFloat({ min: 1 })
    .withMessage('Amount must be at least 1'),
  body('paymentMethod')
    .isIn(['credit_card', 'debit_card', 'paypal', 'mpesa', 'bank_transfer', 'cash', 'check', 'other'])
    .withMessage('Invalid payment method'),
  body('purpose')
    .optional()
    .isIn(['general', 'education', 'health', 'community', 'environment', 'technology', 'emergency', 'other'])
    .withMessage('Invalid purpose'),
  body('message')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Message cannot exceed 500 characters')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed',
        errors: errors.array() 
      });
    }

    const donationData = {
      ...req.body,
      processedBy: req.user?._id // If user is logged in
    };

    // Handle anonymous donations
    if (donationData.donor.isAnonymous) {
      donationData.donor.firstName = 'Anonymous';
      donationData.donor.lastName = 'Donor';
      donationData.donor.email = 'anonymous@kamune-elites.org';
    }

    const donation = await Donation.create(donationData);

    // TODO: Integrate with payment gateway (Stripe, PayPal, M-Pesa)
    // For now, simulate payment processing
    if (donation.paymentMethod === 'cash' || donation.paymentMethod === 'check') {
      // Manual payment methods - mark as pending
      donation.paymentStatus = 'pending';
    } else {
      // Online payment methods - simulate processing
      donation.paymentStatus = 'completed';
      donation.transactionId = `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      donation.verificationDate = new Date();
      donation.isVerified = true;
    }

    await donation.save();

    res.status(201).json({
      donation,
      message: 'Donation received successfully',
      nextSteps: donation.paymentStatus === 'completed' 
        ? 'Thank you for your donation!' 
        : 'Please complete your payment to finalize the donation.'
    });
  } catch (error) {
    console.error('Create donation error:', error);
    res.status(500).json({ message: 'Server error processing donation' });
  }
});

// @desc    Initiate M-Pesa STK Push
// @route   POST /api/donations/mpesa-initiate
// @access  Public
router.post('/mpesa-initiate', [
  body('amount').isFloat({ min: 1 }).withMessage('Amount must be at least 1'),
  body('phone').isMobilePhone('en-KE').withMessage('Valid Kenyan phone number required'),
  body('accountReference').optional().isString(),
  body('transactionDesc').optional().isString(),
  body('email').isEmail().withMessage('Valid email is required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.error('Validation errors:', errors.array());
    return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
  }
  const { amount, phone, accountReference = 'Donation', transactionDesc = 'Kamune Elites Donation', email } = req.body;
  try {
    // Create a pending donation record
    const [firstName, ...lastNameParts] = accountReference.split(' ');
    const lastName = lastNameParts.join(' ');
    const donation = await Donation.create({
      donor: {
        firstName: firstName || '',
        lastName: lastName || '',
        email,
        phone,
        isAnonymous: false,
      },
      amount,
      currency: 'KES',
      paymentMethod: 'mpesa',
      paymentStatus: 'pending',
      purpose: transactionDesc,
    });
    const mpesaRes = await initiateStkPush({ amount, phone, accountReference, transactionDesc });
    // Save CheckoutRequestID to donation for later reference
    donation.transactionId = mpesaRes.CheckoutRequestID;
    await donation.save();
    res.json(mpesaRes);
  } catch (error) {
    console.error('M-Pesa STK Push error:', error.response?.data || error.message, error.response?.data || error);
    res.status(error.response?.status || 500).json({ message: 'M-Pesa STK Push failed', error: error.response?.data || error.message });
  }
});

// @desc    M-Pesa Payment Callback
// @route   POST /api/donations/mpesa-callback
// @access  Public
router.post('/mpesa-callback', async (req, res) => {
  try {
    const body = req.body;
    const stkCallback = body.Body?.stkCallback;
    if (!stkCallback) return res.json({ ResultCode: 0, ResultDesc: 'No callback data' });
    const checkoutRequestId = stkCallback.CheckoutRequestID;
    const resultCode = stkCallback.ResultCode;
    const resultDesc = stkCallback.ResultDesc;
    // Find the donation by transactionId (CheckoutRequestID)
    const donation = await Donation.findOne({ transactionId: checkoutRequestId });
    if (!donation) return res.json({ ResultCode: 0, ResultDesc: 'Donation not found' });
    if (resultCode === 0) {
      // Payment successful
      donation.paymentStatus = 'completed';
      donation.receiptNumber = stkCallback.CallbackMetadata?.Item?.find(i => i.Name === 'MpesaReceiptNumber')?.Value || '';
      donation.isVerified = true;
      donation.verificationDate = new Date();
      await donation.save();
    } else {
      // Payment failed
      donation.paymentStatus = 'failed';
      await donation.save();
    }
    res.json({ ResultCode: 0, ResultDesc: 'Received successfully' });
  } catch (err) {
    console.error('M-Pesa Callback error:', err);
    res.json({ ResultCode: 0, ResultDesc: 'Error processing callback' });
  }
});

// @desc    Get single donation
// @route   GET /api/donations/:id
// @access  Private (Admin or Donor)
router.get('/:id', protect, async (req, res) => {
  try {
    const donation = await Donation.findById(req.params.id)
      .populate('processedBy', 'firstName lastName');

    if (!donation) {
      return res.status(404).json({ message: 'Donation not found' });
    }

    // Check if user can view this donation
    if (req.user.role !== 'admin' && 
        donation.donor.email !== req.user.email) {
      return res.status(403).json({ message: 'Not authorized to view this donation' });
    }

    res.json(donation);
  } catch (error) {
    console.error('Get donation error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @desc    Update donation status (Admin only)
// @route   PUT /api/donations/:id/status
// @access  Private (Admin)
router.put('/:id/status', protect, authorize('admin'), [
  body('paymentStatus')
    .isIn(['pending', 'completed', 'failed', 'refunded', 'cancelled'])
    .withMessage('Invalid payment status'),
  body('notes')
    .optional()
    .isLength({ max: 1000 })
    .withMessage('Notes cannot exceed 1000 characters')
], async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed',
        errors: errors.array() 
      });
    }

    const donation = await Donation.findById(req.params.id);

    if (!donation) {
      return res.status(404).json({ message: 'Donation not found' });
    }

    const { paymentStatus, notes, transactionId } = req.body;

    // Update donation
    donation.paymentStatus = paymentStatus;
    if (notes) donation.notes = notes;
    if (transactionId) donation.transactionId = transactionId;

    // If marking as completed, set verification details
    if (paymentStatus === 'completed' && !donation.isVerified) {
      donation.verificationDate = new Date();
      donation.isVerified = true;
      if (!donation.receiptNumber) {
        donation.receiptNumber = donation.generateReceiptNumber();
      }
    }

    await donation.save();

    res.json({
      donation,
      message: 'Donation status updated successfully'
    });
  } catch (error) {
    console.error('Update donation status error:', error);
    res.status(500).json({ message: 'Server error updating donation status' });
  }
});

// @desc    Get user's donation history
// @route   GET /api/donations/user/history
// @access  Private
router.get('/user/history', protect, async (req, res) => {
  try {
    const donations = await Donation.find({
      'donor.email': req.user.email
    })
    .sort({ createdAt: -1 });

    res.json(donations);
  } catch (error) {
    console.error('Get user donations error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @desc    Send tax receipt (Admin only)
// @route   POST /api/donations/:id/send-receipt
// @access  Private (Admin)
router.post('/:id/send-receipt', protect, authorize('admin'), async (req, res) => {
  try {
    const donation = await Donation.findById(req.params.id);

    if (!donation) {
      return res.status(404).json({ message: 'Donation not found' });
    }

    if (donation.paymentStatus !== 'completed') {
      return res.status(400).json({ message: 'Can only send receipts for completed donations' });
    }

    if (donation.taxReceiptSent) {
      return res.status(400).json({ message: 'Tax receipt already sent' });
    }

    // Send tax receipt
    await donation.sendTaxReceipt();

    // TODO: Send email with tax receipt

    res.json({
      message: 'Tax receipt sent successfully',
      donation
    });
  } catch (error) {
    console.error('Send tax receipt error:', error);
    res.status(500).json({ message: 'Server error sending tax receipt' });
  }
});

// @desc    Get donation receipt
// @route   GET /api/donations/:id/receipt
// @access  Private (Admin or Donor)
router.get('/:id/receipt', protect, async (req, res) => {
  try {
    const donation = await Donation.findById(req.params.id);

    if (!donation) {
      return res.status(404).json({ message: 'Donation not found' });
    }

    // Check if user can view this receipt
    if (req.user.role !== 'admin' && 
        donation.donor.email !== req.user.email) {
      return res.status(403).json({ message: 'Not authorized to view this receipt' });
    }

    if (donation.paymentStatus !== 'completed') {
      return res.status(400).json({ message: 'Receipt not available for incomplete donations' });
    }

    // Generate receipt data
    const receipt = {
      receiptNumber: donation.receiptNumber,
      date: donation.createdAt,
      donor: {
        name: donation.donorFullName,
        email: donation.donor.email,
        address: donation.donor.address
      },
      amount: donation.formattedAmount,
      purpose: donation.purpose,
      paymentMethod: donation.paymentMethod,
      transactionId: donation.transactionId,
      foundation: {
        name: 'Kamune Cluster Elites Foundation',
        address: 'Your Foundation Address',
        phone: 'Your Foundation Phone',
        email: 'info@kamune-elites.org'
      }
    };

    res.json(receipt);
  } catch (error) {
    console.error('Get receipt error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 