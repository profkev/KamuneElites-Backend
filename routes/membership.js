const express = require('express');
const { body, validationResult } = require('express-validator');
const Membership = require('../models/Membership');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');
const { initiateStkPush } = require('../mpesa');

const router = express.Router();

// @desc    Get membership fees
// @route   GET /api/membership/fees
// @access  Public
router.get('/fees', async (req, res) => {
  try {
    const fees = Membership.getMembershipFees();
    res.json(fees);
  } catch (error) {
    console.error('Get fees error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @desc    Get all membership applications (Admin only)
// @route   GET /api/membership
// @access  Private (Admin)
router.get('/', protect, authorize('admin'), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      membershipType,
      search,
      sortBy = 'applicationDate',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    const query = {};

    // Status filter
    if (status) {
      query.status = status;
    }

    // Membership type filter
    if (membershipType) {
      query.membershipType = membershipType;
    }

    // Search filter
    if (search) {
      query.$or = [
        { membershipNumber: { $regex: search, $options: 'i' } },
        { 'personalInfo.occupation': { $regex: search, $options: 'i' } },
        { 'personalInfo.employer': { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);

    // Sorting
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const memberships = await Membership.find(query)
      .populate('applicant', 'firstName lastName email')
      .populate('reviewedBy', 'firstName lastName')
      .sort(sort)
      .skip(skip)
      .limit(limitNum);

    const total = await Membership.countDocuments(query);

    res.json({
      memberships,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limitNum),
        totalApplications: total,
        hasNextPage: skip + limitNum < total,
        hasPrevPage: parseInt(page) > 1
      }
    });
  } catch (error) {
    console.error('Get memberships error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @desc    Get user's membership application
// @route   GET /api/membership/my-application
// @access  Private
router.get('/my-application', protect, async (req, res) => {
  try {
    const membership = await Membership.findOne({ applicant: req.user._id })
      .populate('reviewedBy', 'firstName lastName');

    if (!membership) {
      return res.status(404).json({ message: 'No membership application found' });
    }

    // Check payment status
    await membership.checkPaymentStatus();

    res.json(membership);
  } catch (error) {
    console.error('Get my membership error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @desc    Get user's membership payment history
// @route   GET /api/membership/payment-history
// @access  Private
router.get('/payment-history', protect, async (req, res) => {
  try {
    const membership = await Membership.findOne({ applicant: req.user._id });

    if (!membership) {
      return res.status(404).json({ message: 'No membership found' });
    }

    res.json({
      payments: membership.payments,
      paymentProgress: membership.paymentProgress,
      fees: membership.fees
    });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @desc    Submit membership application
// @route   POST /api/membership/apply
// @access  Private
router.post('/apply', protect, [
  body('membershipType')
    .isIn(['gold', 'silver', 'bronze'])
    .withMessage('Invalid membership type'),
  body('paymentPlan')
    .isIn(['monthly', 'annual'])
    .withMessage('Invalid payment plan'),
  body('personalInfo.dateOfBirth')
    .optional()
    .isISO8601()
    .withMessage('Please provide a valid date of birth'),
  body('personalInfo.nationality')
    .trim()
    .notEmpty()
    .withMessage('Nationality is required'),
  body('personalInfo.occupation')
    .trim()
    .notEmpty()
    .withMessage('Occupation is required'),
  body('personalInfo.employer')
    .trim()
    .notEmpty()
    .withMessage('Employer is required'),
  body('personalInfo.education.highestDegree')
    .trim()
    .notEmpty()
    .withMessage('Highest degree is required'),
  body('personalInfo.education.institution')
    .trim()
    .notEmpty()
    .withMessage('Institution is required'),
  body('personalInfo.education.graduationYear')
    .optional()
    .isInt({ min: 1950, max: new Date().getFullYear() })
    .withMessage('Please provide a valid graduation year'),
  body('contactInfo.phone')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Phone number is required'),
  body('contactInfo.address.street')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Street address is required'),
  body('contactInfo.address.city')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('City is required'),
  body('contactInfo.address.country')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Country is required'),
  body('references')
    .isArray({ min: 2, max: 3 })
    .withMessage('Please provide 2-3 references'),
  body('references.*.name')
    .trim()
    .notEmpty()
    .withMessage('Reference name is required'),
  body('references.*.title')
    .trim()
    .notEmpty()
    .withMessage('Reference title is required'),
  body('references.*.organization')
    .trim()
    .notEmpty()
    .withMessage('Reference organization is required'),
  body('references.*.email')
    .isEmail()
    .withMessage('Please provide a valid reference email'),
  body('references.*.phone')
    .trim()
    .notEmpty()
    .withMessage('Reference phone is required'),
  body('motivation')
    .trim()
    .isLength({ min: 100, max: 1000 })
    .withMessage('Motivation must be between 100 and 1000 characters'),
  body('goals')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Goals cannot exceed 500 characters'),
  body('experience')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Experience cannot exceed 1000 characters'),
  body('contributions')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Contributions cannot exceed 500 characters'),
  body('volunteerInterests')
    .optional()
    .isArray()
    .withMessage('Volunteer interests must be an array'),
  body('availability')
    .optional()
    .isIn(['weekdays', 'weekends', 'evenings', 'flexible', 'limited'])
    .withMessage('Invalid availability option')
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

    // Check if user already has a membership application
    const existingApplication = await Membership.findOne({ applicant: req.user._id });
    if (existingApplication) {
      return res.status(400).json({ 
        message: 'You already have a membership application',
        application: existingApplication
      });
    }

    // Get membership fees
    const fees = Membership.getMembershipFees();
    const selectedFees = fees[req.body.membershipType];

    const membershipData = {
      ...req.body,
      applicant: req.user._id,
      fees: {
        monthlyAmount: selectedFees.monthly,
        annualAmount: selectedFees.annual,
        currency: 'KSH',
        selectedPlan: req.body.paymentPlan,
        selectedAmount: req.body.paymentPlan === 'monthly' ? selectedFees.monthly : selectedFees.annual
      }
    };

    const membership = await Membership.create(membershipData);

    res.status(201).json({
      membership,
      message: 'Membership application submitted successfully'
    });
  } catch (error) {
    console.error('Submit membership application error:', error);
    res.status(500).json({ message: 'Server error submitting application' });
  }
});

// @desc    Process membership payment
// @route   POST /api/membership/:id/pay
// @access  Private
router.post('/:id/pay', protect, [
  body('paymentMethod')
    .isIn(['mpesa', 'card', 'bank_transfer'])
    .withMessage('Invalid payment method'),
  body('amount')
    .isFloat({ min: 1 })
    .withMessage('Amount must be greater than 0'),
  body('phoneNumber')
    .optional()
    .custom((value, { req }) => {
      if (req.body.paymentMethod === 'mpesa' && !value) {
        throw new Error('Phone number is required for M-PESA payments');
      }
      if (value && !/^254\d{9}$/.test(value)) {
        throw new Error('Phone number must be in format: 254XXXXXXXXX');
      }
      return true;
    })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed',
        errors: errors.array() 
      });
    }

    const membership = await Membership.findById(req.params.id);
    if (!membership) {
      return res.status(404).json({ message: 'Membership not found' });
    }

    // Check if user owns this membership
    if (membership.applicant.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Generate payment ID
    const paymentId = `MEM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create payment data
    const paymentData = {
      paymentId,
      amount: req.body.amount,
      paymentMethod: req.body.paymentMethod,
      transactionId: req.body.transactionId || null,
      status: 'pending',
      mpesaDetails: req.body.paymentMethod === 'mpesa' ? {
        phoneNumber: req.body.phoneNumber
      } : null,
      period: {
        startDate: new Date(),
        endDate: new Date()
      },
      notes: req.body.notes || ''
    };

    // Set period end date based on payment plan
    if (membership.fees.selectedPlan === 'annual') {
      paymentData.period.endDate.setFullYear(paymentData.period.endDate.getFullYear() + 1);
    } else {
      paymentData.period.endDate.setMonth(paymentData.period.endDate.getMonth() + 1);
    }

    // Add payment to membership
    await membership.addPayment(paymentData);

    // If payment method is MPESA, initiate payment using existing API
    if (req.body.paymentMethod === 'mpesa') {
      try {
        const mpesaResponse = await initiateStkPush({
          amount: req.body.amount,
          phone: req.body.phoneNumber,
          accountReference: `MEM-${membership.membershipType.toUpperCase()}-${membership._id}`,
          transactionDesc: `${membership.membershipType.charAt(0).toUpperCase() + membership.membershipType.slice(1)} Membership Payment`
        });

        // Update payment with M-PESA response
        const payment = membership.payments.find(p => p.paymentId === paymentId);
        if (payment) {
          payment.transactionId = mpesaResponse.CheckoutRequestID;
          payment.mpesaDetails.transactionCode = mpesaResponse.MerchantRequestID;
          await membership.save();
        }

        res.json({
          message: 'M-PESA payment initiated successfully',
          payment: paymentData,
          mpesaResponse,
          membership
        });
      } catch (mpesaError) {
        console.error('M-PESA payment error:', mpesaError);
        
        // Update payment status to failed
        const payment = membership.payments.find(p => p.paymentId === paymentId);
        if (payment) {
          payment.status = 'failed';
          payment.notes = mpesaError.message || 'M-PESA payment failed';
          await membership.save();
        }

        res.status(400).json({ 
          message: 'M-PESA payment failed',
          error: mpesaError.message 
        });
      }
    } else {
      // For other payment methods, simulate success for now
      paymentData.status = 'completed';
      
      // Update the payment status
      const payment = membership.payments.find(p => p.paymentId === paymentId);
      if (payment) {
        payment.status = 'completed';
        await membership.save();
      }

      res.json({
        message: 'Payment processed successfully',
        payment: paymentData,
        membership
      });
    }
  } catch (error) {
    console.error('Process payment error:', error);
    res.status(500).json({ message: 'Server error processing payment' });
  }
});

// @desc    Update membership application
// @route   PUT /api/membership/:id
// @access  Private (Admin or Applicant)
router.put('/:id', protect, async (req, res) => {
  try {
    const membership = await Membership.findById(req.params.id);
    if (!membership) {
      return res.status(404).json({ message: 'Membership not found' });
    }

    // Check authorization
    if (membership.applicant.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Update fields
    const allowedFields = [
      'personalInfo', 'contactInfo', 'references', 'motivation', 
      'goals', 'experience', 'contributions', 'volunteerInterests', 
      'availability', 'committee', 'notes'
    ];

    allowedFields.forEach(field => {
      if (req.body[field]) {
        membership[field] = req.body[field];
      }
    });

    await membership.save();

    res.json({
      membership,
      message: 'Membership updated successfully'
    });
  } catch (error) {
    console.error('Update membership error:', error);
    res.status(500).json({ message: 'Server error updating membership' });
  }
});

// @desc    Approve membership application (Admin only)
// @route   PUT /api/membership/:id/approve
// @access  Private (Admin)
router.put('/:id/approve', protect, authorize('admin'), async (req, res) => {
  try {
    const membership = await Membership.findById(req.params.id);
    if (!membership) {
      return res.status(404).json({ message: 'Membership not found' });
    }

    if (membership.status !== 'pending') {
      return res.status(400).json({ message: 'Membership is not pending approval' });
    }

    await membership.approve(req.user._id, req.body.notes);

    res.json({
      membership,
      message: 'Membership approved successfully'
    });
  } catch (error) {
    console.error('Approve membership error:', error);
    res.status(500).json({ message: 'Server error approving membership' });
  }
});

// @desc    Suspend membership (Admin only)
// @route   PUT /api/membership/:id/suspend
// @access  Private (Admin)
router.put('/:id/suspend', protect, authorize('admin'), async (req, res) => {
  try {
    const membership = await Membership.findById(req.params.id);
    if (!membership) {
      return res.status(404).json({ message: 'Membership not found' });
    }

    membership.status = 'suspended';
    membership.notes = req.body.notes || membership.notes;
    await membership.save();

    res.json({
      membership,
      message: 'Membership suspended successfully'
    });
  } catch (error) {
    console.error('Suspend membership error:', error);
    res.status(500).json({ message: 'Server error suspending membership' });
  }
});

// @desc    Cancel membership
// @route   PUT /api/membership/:id/cancel
// @access  Private (Admin or Applicant)
router.put('/:id/cancel', protect, async (req, res) => {
  try {
    const membership = await Membership.findById(req.params.id);
    if (!membership) {
      return res.status(404).json({ message: 'Membership not found' });
    }

    // Check authorization
    if (membership.applicant.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    membership.status = 'cancelled';
    membership.notes = req.body.notes || membership.notes;
    await membership.save();

    res.json({
      membership,
      message: 'Membership cancelled successfully'
    });
  } catch (error) {
    console.error('Cancel membership error:', error);
    res.status(500).json({ message: 'Server error cancelling membership' });
  }
});

// @desc    Renew membership
// @route   PUT /api/membership/:id/renew
// @access  Private
router.put('/:id/renew', protect, async (req, res) => {
  try {
    const membership = await Membership.findById(req.params.id);
    if (!membership) {
      return res.status(404).json({ message: 'Membership not found' });
    }

    // Check if user owns this membership
    if (membership.applicant.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (membership.status !== 'active' && membership.status !== 'expired') {
      return res.status(400).json({ message: 'Membership cannot be renewed' });
    }

    await membership.renew();

    res.json({
      membership,
      message: 'Membership renewed successfully'
    });
  } catch (error) {
    console.error('Renew membership error:', error);
    res.status(500).json({ message: 'Server error renewing membership' });
  }
});

// @desc    M-PESA payment callback
// @route   POST /api/membership/mpesa-callback
// @access  Public
router.post('/mpesa-callback', async (req, res) => {
  try {
    const { Body } = req.body;
    const stkCallback = Body.stkCallback;
    
    if (stkCallback.ResultCode === 0) {
      // Payment successful
      const checkoutRequestID = stkCallback.CheckoutRequestID;
      const resultDesc = stkCallback.ResultDesc;
      const amount = stkCallback.CallbackMetadata?.Item?.find(item => item.Name === 'Amount')?.Value;
      const mpesaReceiptNumber = stkCallback.CallbackMetadata?.Item?.find(item => item.Name === 'MpesaReceiptNumber')?.Value;
      const transactionDate = stkCallback.CallbackMetadata?.Item?.find(item => item.Name === 'TransactionDate')?.Value;
      const phoneNumber = stkCallback.CallbackMetadata?.Item?.find(item => item.Name === 'PhoneNumber')?.Value;

      // Find membership payment by checkout request ID
      const membership = await Membership.findOne({
        'payments.transactionId': checkoutRequestID
      });

      if (membership) {
        const payment = membership.payments.find(p => p.transactionId === checkoutRequestID);
        if (payment) {
          payment.status = 'completed';
          payment.mpesaDetails.transactionCode = mpesaReceiptNumber;
          payment.notes = `Payment confirmed: ${resultDesc}`;
          await membership.save();
        }
      }
    } else {
      // Payment failed
      const checkoutRequestID = stkCallback.CheckoutRequestID;
      const resultDesc = stkCallback.ResultDesc;

      const membership = await Membership.findOne({
        'payments.transactionId': checkoutRequestID
      });

      if (membership) {
        const payment = membership.payments.find(p => p.transactionId === checkoutRequestID);
        if (payment) {
          payment.status = 'failed';
          payment.notes = `Payment failed: ${resultDesc}`;
          await membership.save();
        }
      }
    }

    res.json({ message: 'Callback processed successfully' });
  } catch (error) {
    console.error('M-PESA callback error:', error);
    res.status(500).json({ message: 'Callback processing error' });
  }
});

// @desc    Get membership statistics (Admin only)
// @route   GET /api/membership/stats
// @access  Private (Admin)
router.get('/stats', protect, authorize('admin'), async (req, res) => {
  try {
    const totalMembers = await Membership.countDocuments({ status: 'active' });
    const pendingApplications = await Membership.countDocuments({ status: 'pending' });
    const suspendedMembers = await Membership.countDocuments({ status: 'suspended' });
    const expiredMembers = await Membership.countDocuments({ status: 'expired' });

    // Payment statistics
    const overduePayments = await Membership.countDocuments({
      'paymentProgress.paymentStatus': 'overdue'
    });

    const totalRevenue = await Membership.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: null, total: { $sum: '$paymentProgress.totalPaid' } } }
    ]);

    res.json({
      totalMembers,
      pendingApplications,
      suspendedMembers,
      expiredMembers,
      overduePayments,
      totalRevenue: totalRevenue[0]?.total || 0
    });
  } catch (error) {
    console.error('Get membership stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 