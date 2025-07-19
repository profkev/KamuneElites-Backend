const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const Gallery = require('../models/Gallery');
const { protect, isAdmin } = require('../middleware/auth');

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

// List all gallery images (public)
router.get('/', async (req, res) => {
  try {
    const images = await Gallery.find().sort({ createdAt: -1 });
    res.json(images);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch gallery images' });
  }
});

// Upload a new image (admin only)
router.post('/', protect, isAdmin, upload.single('image'), async (req, res) => {
  try {
    console.log('Upload request received');
    console.log('User:', req.user);
    console.log('File:', req.file);
    console.log('Body:', req.body);
    
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No image file provided' });

    // Upload to Cloudinary
    const stream = cloudinary.uploader.upload_stream({ resource_type: 'image' }, async (error, result) => {
      if (error) {
        console.error('Cloudinary error:', error);
        return res.status(500).json({ error: 'Cloudinary upload failed' });
      }
      console.log('Cloudinary result:', result);
      const { secure_url } = result;
      
      // Generate title from filename if not provided
      const title = req.body.title || file.originalname.replace(/\.[^/.]+$/, "");
      const description = req.body.description || '';
      
      const image = new Gallery({
        url: secure_url,
        title,
        description,
        uploadedBy: req.user._id
      });
      await image.save();
      res.status(201).json(image);
    });
    stream.end(file.buffer);
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// Update image metadata (admin only)
router.put('/:id', protect, isAdmin, async (req, res) => {
  try {
    const { title, description } = req.body;
    const image = await Gallery.findByIdAndUpdate(
      req.params.id,
      { title, description },
      { new: true }
    );
    if (!image) return res.status(404).json({ error: 'Image not found' });
    res.json(image);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update image' });
  }
});

// Delete image (admin only)
router.delete('/:id', protect, isAdmin, async (req, res) => {
  try {
    console.log('Delete request for image ID:', req.params.id);
    
    const image = await Gallery.findById(req.params.id);
    if (!image) {
      console.log('Image not found');
      return res.status(404).json({ error: 'Image not found' });
    }
    
    console.log('Found image:', image.title);
    
    // Delete from database using findByIdAndDelete
    const deletedImage = await Gallery.findByIdAndDelete(req.params.id);
    
    if (!deletedImage) {
      console.log('Failed to delete image from database');
      return res.status(500).json({ error: 'Failed to delete image from database' });
    }
    
    console.log('Image deleted successfully');
    res.json({ message: 'Image deleted successfully' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete image' });
  }
});

module.exports = router; 