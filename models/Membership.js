const mongoose = require('mongoose');

const membershipSchema = new mongoose.Schema({
  applicant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  membershipType: {
    type: String,
    enum: ['gold', 'silver', 'bronze'],
    required: [true, 'Membership type is required']
  },
  paymentPlan: {
    type: String,
    enum: ['monthly', 'annual'],
    required: [true, 'Payment plan is required']
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'suspended', 'expired', 'cancelled'],
    default: 'pending'
  },
  applicationDate: {
    type: Date,
    default: Date.now
  },
  approvalDate: {
    type: Date
  },
  startDate: {
    type: Date
  },
  expiryDate: {
    type: Date
  },
  membershipNumber: {
    type: String,
    unique: true,
    sparse: true
  },
  personalInfo: {
    dateOfBirth: Date,
    nationality: String,
    occupation: String,
    employer: String,
    education: {
      highestDegree: String,
      institution: String,
      graduationYear: Number
    },
    skills: [String],
    interests: [String]
  },
  contactInfo: {
    phone: String,
    address: {
      street: String,
      city: String,
      state: String,
      zipCode: String,
      country: String
    },
    emergencyContact: {
      name: String,
      relationship: String,
      phone: String,
      email: String
    }
  },
  references: [{
    name: String,
    title: String,
    organization: String,
    email: String,
    phone: String,
    relationship: String
  }],
  motivation: {
    type: String,
    required: [true, 'Motivation statement is required'],
    maxlength: [1000, 'Motivation cannot exceed 1000 characters']
  },
  goals: {
    type: String,
    maxlength: [500, 'Goals cannot exceed 500 characters']
  },
  experience: {
    type: String,
    maxlength: [1000, 'Experience cannot exceed 1000 characters']
  },
  contributions: {
    type: String,
    maxlength: [500, 'Contributions cannot exceed 500 characters']
  },
  documents: [{
    name: String,
    type: String,
    url: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  // Updated fees structure for monthly/annual payments
  fees: {
    monthlyAmount: {
      type: Number,
      required: true
    },
    annualAmount: {
      type: Number,
      required: true
    },
    currency: {
      type: String,
      default: 'KSH'
    },
    selectedPlan: {
      type: String,
      enum: ['monthly', 'annual'],
      required: true
    },
    selectedAmount: {
      type: Number,
      required: true
    }
  },
  // Payment tracking
  payments: [{
    paymentId: {
      type: String,
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    paymentDate: {
      type: Date,
      default: Date.now
    },
    paymentMethod: {
      type: String,
      enum: ['mpesa', 'card', 'bank_transfer'],
      required: true
    },
    transactionId: String,
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded'],
      default: 'pending'
    },
    mpesaDetails: {
      phoneNumber: String,
      transactionCode: String
    },
    period: {
      startDate: Date,
      endDate: Date
    },
    notes: String
  }],
  // Payment progress tracking
  paymentProgress: {
    totalPaid: {
      type: Number,
      default: 0
    },
    lastPaymentDate: Date,
    nextPaymentDate: Date,
    paymentStatus: {
      type: String,
      enum: ['up_to_date', 'overdue', 'pending'],
      default: 'pending'
    },
    overdueAmount: {
      type: Number,
      default: 0
    },
    consecutivePayments: {
      type: Number,
      default: 0
    }
  },
  committee: {
    type: String,
    enum: ['none', 'education', 'health', 'community', 'environment', 'technology', 'finance', 'events', 'other']
  },
  volunteerInterests: [{
    type: String,
    enum: ['mentoring', 'event_planning', 'fundraising', 'community_outreach', 'technical_support', 'administration', 'other']
  }],
  availability: {
    type: String,
    enum: ['weekdays', 'weekends', 'evenings', 'flexible', 'limited']
  },
  notes: {
    type: String,
    maxlength: [1000, 'Notes cannot exceed 1000 characters']
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reviewNotes: {
    type: String,
    maxlength: [1000, 'Review notes cannot exceed 1000 characters']
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastRenewalDate: {
    type: Date
  },
  renewalReminderSent: {
    type: Boolean,
    default: false
  },
  // Auto-renewal settings
  autoRenewal: {
    enabled: {
      type: Boolean,
      default: false
    },
    paymentMethod: {
      type: String,
      enum: ['mpesa', 'card', 'bank_transfer']
    },
    lastRenewalAttempt: Date
  }
}, {
  timestamps: true
});

// Index for better query performance
membershipSchema.index({ applicant: 1, status: 1 });
membershipSchema.index({ membershipType: 1, status: 1 });
membershipSchema.index({ membershipNumber: 1 });
membershipSchema.index({ expiryDate: 1, status: 1 });
membershipSchema.index({ 'paymentProgress.nextPaymentDate': 1 });

// Virtual for membership duration
membershipSchema.virtual('duration').get(function() {
  if (!this.startDate) return null;
  const now = new Date();
  const start = this.startDate;
  const end = this.expiryDate || now;
  
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
});

// Virtual for days until expiry
membershipSchema.virtual('daysUntilExpiry').get(function() {
  if (!this.expiryDate || this.status !== 'active') return null;
  const now = new Date();
  const diffTime = this.expiryDate - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
});

// Virtual for membership status
membershipSchema.virtual('statusColor').get(function() {
  const statusColors = {
    pending: 'yellow',
    active: 'green',
    suspended: 'orange',
    expired: 'gray',
    cancelled: 'red'
  };
  return statusColors[this.status] || 'gray';
});

// Virtual for payment progress percentage
membershipSchema.virtual('paymentProgressPercentage').get(function() {
  if (this.fees.selectedPlan === 'annual') {
    return this.paymentProgress.totalPaid >= this.fees.annualAmount ? 100 : 
           Math.round((this.paymentProgress.totalPaid / this.fees.annualAmount) * 100);
  } else {
    // For monthly, calculate based on current month's payment
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const monthlyPayments = this.payments.filter(payment => {
      const paymentDate = new Date(payment.paymentDate);
      return paymentDate.getMonth() === currentMonth && 
             paymentDate.getFullYear() === currentYear &&
             payment.status === 'completed';
    });
    
    return monthlyPayments.length > 0 ? 100 : 0;
  }
});

// Method to generate membership number
membershipSchema.methods.generateMembershipNumber = function() {
  const year = new Date().getFullYear();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  const typeCode = this.membershipType.toUpperCase();
  return `KCE-${typeCode}-${year}-${random}`;
};

// Method to approve membership
membershipSchema.methods.approve = function(reviewerId, notes = '') {
  this.status = 'active';
  this.approvalDate = new Date();
  this.startDate = new Date();
  this.reviewedBy = reviewerId;
  this.reviewNotes = notes;
  this.membershipNumber = this.generateMembershipNumber();
  
  // Set expiry date based on payment plan
  const expiryDate = new Date();
  if (this.fees.selectedPlan === 'annual') {
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
  } else {
    expiryDate.setMonth(expiryDate.getMonth() + 1);
  }
  this.expiryDate = expiryDate;
  
  // Set next payment date
  this.paymentProgress.nextPaymentDate = new Date();
  if (this.fees.selectedPlan === 'annual') {
    this.paymentProgress.nextPaymentDate.setFullYear(this.paymentProgress.nextPaymentDate.getFullYear() + 1);
  } else {
    this.paymentProgress.nextPaymentDate.setMonth(this.paymentProgress.nextPaymentDate.getMonth() + 1);
  }
  
  return this.save();
};

// Method to add payment
membershipSchema.methods.addPayment = function(paymentData) {
  const payment = {
    paymentId: paymentData.paymentId,
    amount: paymentData.amount,
    paymentDate: new Date(),
    paymentMethod: paymentData.paymentMethod,
    transactionId: paymentData.transactionId,
    status: paymentData.status || 'completed',
    mpesaDetails: paymentData.mpesaDetails,
    period: paymentData.period,
    notes: paymentData.notes
  };

  this.payments.push(payment);
  
  // Update payment progress
  if (payment.status === 'completed') {
    this.paymentProgress.totalPaid += payment.amount;
    this.paymentProgress.lastPaymentDate = new Date();
    this.paymentProgress.consecutivePayments += 1;
    
    // Set next payment date
    const nextPaymentDate = new Date();
    if (this.fees.selectedPlan === 'annual') {
      nextPaymentDate.setFullYear(nextPaymentDate.getFullYear() + 1);
    } else {
      nextPaymentDate.setMonth(nextPaymentDate.getMonth() + 1);
    }
    this.paymentProgress.nextPaymentDate = nextPaymentDate;
    
    // Update payment status
    this.paymentProgress.paymentStatus = 'up_to_date';
    this.paymentProgress.overdueAmount = 0;
  }
  
  return this.save();
};

// Method to check payment status
membershipSchema.methods.checkPaymentStatus = function() {
  const now = new Date();
  
  if (this.paymentProgress.nextPaymentDate && now > this.paymentProgress.nextPaymentDate) {
    this.paymentProgress.paymentStatus = 'overdue';
    
    // Calculate overdue amount
    if (this.fees.selectedPlan === 'monthly') {
      const monthsOverdue = Math.floor((now - this.paymentProgress.nextPaymentDate) / (1000 * 60 * 60 * 24 * 30));
      this.paymentProgress.overdueAmount = monthsOverdue * this.fees.monthlyAmount;
    } else {
      this.paymentProgress.overdueAmount = this.fees.annualAmount - this.paymentProgress.totalPaid;
    }
  }
  
  return this.save();
};

// Method to renew membership
membershipSchema.methods.renew = function() {
  if (this.status !== 'active' && this.status !== 'expired') {
    throw new Error('Only active or expired memberships can be renewed');
  }
  
  this.status = 'active';
  this.lastRenewalDate = new Date();
  this.renewalReminderSent = false;
  
  // Extend expiry date
  const newExpiryDate = new Date(this.expiryDate || new Date());
  if (this.fees.selectedPlan === 'annual') {
    newExpiryDate.setFullYear(newExpiryDate.getFullYear() + 1);
  } else {
    newExpiryDate.setMonth(newExpiryDate.getMonth() + 1);
  }
  this.expiryDate = newExpiryDate;
  
  return this.save();
};

// Static method to get membership fees
membershipSchema.statics.getMembershipFees = function() {
  return {
    gold: {
      annual: 5000,
      monthly: Math.round(5000 / 12)
    },
    silver: {
      annual: 3000,
      monthly: Math.round(3000 / 12)
    },
    bronze: {
      annual: 1500,
      monthly: Math.round(1500 / 12)
    }
  };
};

// Ensure virtual fields are serialized
membershipSchema.set('toJSON', {
  virtuals: true
});

module.exports = mongoose.model('Membership', membershipSchema); 