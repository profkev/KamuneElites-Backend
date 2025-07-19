const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Event title is required'],
    trim: true,
    maxlength: [100, 'Event title cannot exceed 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Event description is required'],
    maxlength: [2000, 'Event description cannot exceed 2000 characters']
  },
  shortDescription: {
    type: String,
    maxlength: [300, 'Short description cannot exceed 300 characters']
  },
  date: {
    type: Date,
    required: [true, 'Event date is required']
  },
  endDate: {
    type: Date
  },
  time: {
    start: String,
    end: String
  },
  location: {
    type: String,
    required: [true, 'Event location is required']
  },
  address: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    country: String
  },
  coordinates: {
    latitude: Number,
    longitude: Number
  },
  eventType: {
    type: String,
    enum: ['workshop', 'seminar', 'meeting', 'outreach', 'fundraiser', 'social', 'other'],
    default: 'other'
  },
  category: {
    type: String,
    enum: ['mentorship', 'community', 'education', 'health', 'environment', 'technology', 'other'],
    default: 'other'
  },
  image: {
    type: String,
    default: ''
  },
  images: [{
    type: String
  }],
  imageUrl: {
    type: String,
    default: ''
  },
  capacity: {
    type: Number,
    min: [1, 'Capacity must be at least 1']
  },
  registeredAttendees: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  organizers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  speakers: [{
    name: String,
    title: String,
    bio: String,
    image: String
  }],
  isFree: {
    type: Boolean,
    default: true
  },
  price: {
    type: Number,
    min: [0, 'Price cannot be negative']
  },
  currency: {
    type: String,
    default: 'USD'
  },
  registrationRequired: {
    type: Boolean,
    default: false
  },
  registrationDeadline: {
    type: Date
  },
  status: {
    type: String,
    enum: ['draft', 'published', 'cancelled', 'completed'],
    default: 'draft'
  },
  tags: [{
    type: String,
    trim: true
  }],
  highlights: [{
    type: String
  }],
  requirements: [{
    type: String
  }],
  contactInfo: {
    name: String,
    email: String,
    phone: String
  },
  externalLinks: [{
    title: String,
    url: String
  }],
  isFeatured: {
    type: Boolean,
    default: false
  },
  views: {
    type: Number,
    default: 0
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Index for better query performance
eventSchema.index({ date: 1, status: 1 });
eventSchema.index({ eventType: 1, category: 1 });
eventSchema.index({ isFeatured: 1, date: 1 });

// Virtual for checking if event is upcoming
eventSchema.virtual('isUpcoming').get(function() {
  return this.date > new Date() && this.status === 'published';
});

// Virtual for checking if event is past
eventSchema.virtual('isPast').get(function() {
  return this.date < new Date();
});

// Virtual for registration count
eventSchema.virtual('registrationCount').get(function() {
  return this.registeredAttendees ? this.registeredAttendees.length : 0;
});

// Virtual for available spots
eventSchema.virtual('availableSpots').get(function() {
  if (!this.capacity) return null;
  return Math.max(0, this.capacity - this.registrationCount);
});

// Method to check if user is registered
eventSchema.methods.isUserRegistered = function(userId) {
  return this.registeredAttendees.includes(userId);
};

// Method to register user
eventSchema.methods.registerUser = function(userId) {
  if (!this.registeredAttendees.includes(userId)) {
    this.registeredAttendees.push(userId);
  }
  return this.save();
};

// Method to unregister user
eventSchema.methods.unregisterUser = function(userId) {
  this.registeredAttendees = this.registeredAttendees.filter(id => !id.equals(userId));
  return this.save();
};

// Ensure virtual fields are serialized
eventSchema.set('toJSON', {
  virtuals: true
});

module.exports = mongoose.model('Event', eventSchema); 