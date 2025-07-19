const mongoose = require('mongoose');

const donationSchema = new mongoose.Schema({
  donor: {
    firstName: {
      type: String,
      required: [true, 'Donor first name is required'],
      trim: true
    },
    lastName: {
      type: String,
      required: [true, 'Donor last name is required'],
      trim: true
    },
    email: {
      type: String,
      required: [true, 'Donor email is required'],
      lowercase: true,
      trim: true
    },
    phone: {
      type: String,
      trim: true
    },
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String
    },
    isAnonymous: {
      type: Boolean,
      default: false
    }
  },
  amount: {
    type: Number,
    required: [true, 'Donation amount is required'],
    min: [1, 'Donation amount must be at least 1']
  },
  currency: {
    type: String,
    default: 'USD',
    enum: ['USD', 'EUR', 'GBP', 'KES', 'NGN', 'GHS', 'ZAR']
  },
  paymentMethod: {
    type: String,
    required: [true, 'Payment method is required'],
    enum: ['credit_card', 'debit_card', 'paypal', 'mpesa', 'bank_transfer', 'cash', 'check', 'other']
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded', 'cancelled'],
    default: 'pending'
  },
  transactionId: {
    type: String,
    unique: true,
    sparse: true
  },
  receiptNumber: {
    type: String,
    unique: true,
    sparse: true
  },
  donationType: {
    type: String,
    enum: ['one_time', 'monthly', 'yearly', 'campaign', 'memorial', 'honor'],
    default: 'one_time'
  },
  campaign: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Campaign'
  },
  purpose: {
    type: String,
    enum: ['general', 'education', 'health', 'community', 'environment', 'technology', 'emergency', 'other'],
    default: 'general'
  },
  message: {
    type: String,
    maxlength: [500, 'Message cannot exceed 500 characters']
  },
  isRecurring: {
    type: Boolean,
    default: false
  },
  recurringInterval: {
    type: String,
    enum: ['monthly', 'quarterly', 'yearly'],
    default: 'monthly'
  },
  nextPaymentDate: {
    type: Date
  },
  totalDonations: {
    type: Number,
    default: 0
  },
  taxReceiptSent: {
    type: Boolean,
    default: false
  },
  taxReceiptDate: {
    type: Date
  },
  notes: {
    type: String,
    maxlength: [1000, 'Notes cannot exceed 1000 characters']
  },
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationDate: {
    type: Date
  }
}, {
  timestamps: true
});

// Index for better query performance
donationSchema.index({ 'donor.email': 1 });
donationSchema.index({ paymentStatus: 1, createdAt: 1 });
donationSchema.index({ donationType: 1, purpose: 1 });
donationSchema.index({ transactionId: 1 });

// Virtual for donor full name
donationSchema.virtual('donorFullName').get(function() {
  if (this.donor.isAnonymous) {
    return 'Anonymous Donor';
  }
  return `${this.donor.firstName} ${this.donor.lastName}`;
});

// Virtual for formatted amount
donationSchema.virtual('formattedAmount').get(function() {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: this.currency
  }).format(this.amount);
});

// Virtual for donation status
donationSchema.virtual('statusColor').get(function() {
  const statusColors = {
    pending: 'yellow',
    completed: 'green',
    failed: 'red',
    refunded: 'blue',
    cancelled: 'gray'
  };
  return statusColors[this.paymentStatus] || 'gray';
});

// Method to generate receipt number
donationSchema.methods.generateReceiptNumber = function() {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `KCE-${year}-${random}`;
};

// Method to mark as completed
donationSchema.methods.markAsCompleted = function(transactionId) {
  this.paymentStatus = 'completed';
  this.transactionId = transactionId;
  this.receiptNumber = this.generateReceiptNumber();
  this.verificationDate = new Date();
  this.isVerified = true;
  return this.save();
};

// Method to send tax receipt
donationSchema.methods.sendTaxReceipt = function() {
  this.taxReceiptSent = true;
  this.taxReceiptDate = new Date();
  return this.save();
};

// Ensure virtual fields are serialized
donationSchema.set('toJSON', {
  virtuals: true,
  transform: function(doc, ret) {
    if (ret.donor && ret.donor.isAnonymous) {
      ret.donor.firstName = 'Anonymous';
      ret.donor.lastName = 'Donor';
      ret.donor.email = '';
      ret.donor.phone = '';
      ret.donor.address = {};
    }
    return ret;
  }
});

module.exports = mongoose.model('Donation', donationSchema); 