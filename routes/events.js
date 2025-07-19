const express = require('express');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const Event = require('../models/Event');
const { protect, authorize, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Cloudinary config
cloudinary.config(); // Uses CLOUDINARY_URL from environment

// Multer setup (memory storage)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// @desc    Get all events
// @route   GET /api/events
// @access  Public
router.get('/', optionalAuth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status = 'published',
      eventType,
      category,
      search,
      featured,
      upcoming,
      past
    } = req.query;

    // Build query
    const query = {};

    // Status filter
    if (status !== 'all') {
      query.status = status;
    }

    // Event type filter
    if (eventType) {
      query.eventType = eventType;
    }

    // Category filter
    if (category) {
      query.category = category;
    }

    // Featured filter
    if (featured === 'true') {
      query.isFeatured = true;
    }

    // Date filters
    if (upcoming === 'true') {
      query.date = { $gt: new Date() };
    } else if (past === 'true') {
      query.date = { $lt: new Date() };
    }

    // Search filter
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } }
      ];
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);

    const events = await Event.find(query)
      .populate('createdBy', 'firstName lastName')
      .populate('organizers', 'firstName lastName')
      .sort({ date: 1, isFeatured: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Event.countDocuments(query);

    res.json({
      events,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limitNum),
        totalEvents: total,
        hasNextPage: skip + limitNum < total,
        hasPrevPage: parseInt(page) > 1
      }
    });
  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @desc    Get single event
// @route   GET /api/events/:id
// @access  Public
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate('createdBy', 'firstName lastName email')
      .populate('organizers', 'firstName lastName email')
      .populate('registeredAttendees', 'firstName lastName email');

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Increment views
    event.views += 1;
    await event.save();

    // Check if user is registered (if authenticated)
    let isUserRegistered = false;
    if (req.user) {
      isUserRegistered = event.isUserRegistered(req.user._id);
    }

    res.json({
      ...event.toJSON(),
      isUserRegistered
    });
  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @desc    Create new event
// @route   POST /api/events
// @access  Private (Admin/Member)
router.post('/', protect, authorize('admin', 'member'), upload.single('image'), [
  body('title')
    .trim()
    .isLength({ min: 5, max: 100 })
    .withMessage('Title must be between 5 and 100 characters'),
  body('description')
    .trim()
    .isLength({ min: 20, max: 2000 })
    .withMessage('Description must be between 20 and 2000 characters'),
  body('date')
    .isISO8601()
    .withMessage('Please provide a valid date'),
  body('location')
    .trim()
    .notEmpty()
    .withMessage('Location is required'),
  body('eventType')
    .isIn(['workshop', 'seminar', 'meeting', 'outreach', 'fundraiser', 'social', 'other'])
    .withMessage('Invalid event type'),
  body('category')
    .isIn(['mentorship', 'community', 'education', 'health', 'environment', 'technology', 'other'])
    .withMessage('Invalid category')
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

    const eventData = {
      ...req.body,
      createdBy: req.user._id
    };

    // Handle image upload if provided
    if (req.file) {
      const stream = cloudinary.uploader.upload_stream({ resource_type: 'image' }, async (error, result) => {
        if (error) {
          console.error('Cloudinary error:', error);
          return res.status(500).json({ message: 'Image upload failed' });
        }
        
        eventData.imageUrl = result.secure_url;
        
        // Set organizers if not provided
        if (!eventData.organizers || eventData.organizers.length === 0) {
          eventData.organizers = [req.user._id];
        }

        const event = await Event.create(eventData);
        res.status(201).json(event);
      });
      stream.end(req.file.buffer);
    } else {
      // Set organizers if not provided
      if (!eventData.organizers || eventData.organizers.length === 0) {
        eventData.organizers = [req.user._id];
      }

      const event = await Event.create(eventData);
      res.status(201).json(event);
    }
  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({ message: 'Server error creating event' });
  }
});

// @desc    Update event
// @route   PUT /api/events/:id
// @access  Private (Admin/Event Creator)
router.put('/:id', protect, upload.single('image'), async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Check if user can edit this event
    if (req.user.role !== 'admin' && event.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to edit this event' });
    }

    const updateData = { ...req.body };

    // Handle image upload if provided
    if (req.file) {
      const stream = cloudinary.uploader.upload_stream({ resource_type: 'image' }, async (error, result) => {
        if (error) {
          console.error('Cloudinary error:', error);
          return res.status(500).json({ message: 'Image upload failed' });
        }
        
        updateData.imageUrl = result.secure_url;
        
        // Update event
        const updatedEvent = await Event.findByIdAndUpdate(
          req.params.id,
          updateData,
          { new: true, runValidators: true }
        );

        res.json(updatedEvent);
      });
      stream.end(req.file.buffer);
    } else {
      // Update event without image
      const updatedEvent = await Event.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true, runValidators: true }
      );

      res.json(updatedEvent);
    }
  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({ message: 'Server error updating event' });
  }
});

// @desc    Delete event
// @route   DELETE /api/events/:id
// @access  Private (Admin/Event Creator)
router.delete('/:id', protect, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Check if user can delete this event
    if (req.user.role !== 'admin' && event.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to delete this event' });
    }

    await Event.findByIdAndDelete(req.params.id);

    res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({ message: 'Server error deleting event' });
  }
});

// @desc    Register for event
// @route   POST /api/events/:id/register
// @access  Private
router.post('/:id/register', protect, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    if (event.status !== 'published') {
      return res.status(400).json({ message: 'Event is not available for registration' });
    }

    if (event.isPast) {
      return res.status(400).json({ message: 'Event has already passed' });
    }

    // Check if registration is required
    if (event.registrationRequired) {
      if (event.registrationDeadline && new Date() > event.registrationDeadline) {
        return res.status(400).json({ message: 'Registration deadline has passed' });
      }

      if (event.capacity && event.registrationCount >= event.capacity) {
        return res.status(400).json({ message: 'Event is at full capacity' });
      }
    }

    // Check if user is already registered
    if (event.isUserRegistered(req.user._id)) {
      return res.status(400).json({ message: 'Already registered for this event' });
    }

    // Register user
    await event.registerUser(req.user._id);

    res.json({ message: 'Successfully registered for event' });
  } catch (error) {
    console.error('Event registration error:', error);
    res.status(500).json({ message: 'Server error registering for event' });
  }
});

// @desc    Unregister from event
// @route   DELETE /api/events/:id/register
// @access  Private
router.delete('/:id/register', protect, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Check if user is registered
    if (!event.isUserRegistered(req.user._id)) {
      return res.status(400).json({ message: 'Not registered for this event' });
    }

    // Unregister user
    await event.unregisterUser(req.user._id);

    res.json({ message: 'Successfully unregistered from event' });
  } catch (error) {
    console.error('Event unregistration error:', error);
    res.status(500).json({ message: 'Server error unregistering from event' });
  }
});

// @desc    Get user's registered events
// @route   GET /api/events/user/registered
// @access  Private
router.get('/user/registered', protect, async (req, res) => {
  try {
    const events = await Event.find({
      registeredAttendees: req.user._id
    })
    .populate('createdBy', 'firstName lastName')
    .sort({ date: 1 });

    res.json(events);
  } catch (error) {
    console.error('Get user events error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @desc    Get events created by user
// @route   GET /api/events/user/created
// @access  Private
router.get('/user/created', protect, async (req, res) => {
  try {
    const events = await Event.find({
      createdBy: req.user._id
    })
    .populate('registeredAttendees', 'firstName lastName')
    .sort({ createdAt: -1 });

    res.json(events);
  } catch (error) {
    console.error('Get created events error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @desc    Get event statistics (Admin only)
// @route   GET /api/events/stats/overview
// @access  Private (Admin)
router.get('/stats/overview', protect, authorize('admin'), async (req, res) => {
  try {
    const totalEvents = await Event.countDocuments();
    const publishedEvents = await Event.countDocuments({ status: 'published' });
    const upcomingEvents = await Event.countDocuments({ 
      date: { $gt: new Date() },
      status: 'published'
    });
    const pastEvents = await Event.countDocuments({ 
      date: { $lt: new Date() }
    });

    // Get events by type
    const eventsByType = await Event.aggregate([
      { $group: { _id: '$eventType', count: { $sum: 1 } } }
    ]);

    // Get events by category
    const eventsByCategory = await Event.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } }
    ]);

    res.json({
      totalEvents,
      publishedEvents,
      upcomingEvents,
      pastEvents,
      eventsByType,
      eventsByCategory
    });
  } catch (error) {
    console.error('Get event stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router; 