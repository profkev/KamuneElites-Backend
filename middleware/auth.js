const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Protect routes - require authentication
const protect = async (req, res, next) => {
  let token;

  console.log('Protect middleware - headers:', req.headers.authorization);

  // Check for token in headers
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];
      console.log('Token found:', token ? 'Yes' : 'No');

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      console.log('Token decoded:', decoded);

      // Get user from token
      req.user = await User.findById(decoded.id).select('-password');
      console.log('User found:', req.user ? 'Yes' : 'No');

      if (!req.user) {
        console.log('User not found in database');
        return res.status(401).json({ message: 'User not found' });
      }

      if (!req.user.isActive) {
        console.log('User account is deactivated');
        return res.status(401).json({ message: 'User account is deactivated' });
      }

      console.log('User authenticated successfully:', req.user.email, 'Role:', req.user.role);
      next();
    } catch (error) {
      console.error('Token verification error:', error);
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    console.log('No token provided');
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
};

// Generate JWT token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '24h'
  });
};

// Optional authentication - doesn't require token but sets user if provided
const optionalAuth = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
    } catch (error) {
      // Token is invalid but we don't fail the request
      console.log('Optional auth token invalid:', error.message);
    }
  }

  next();
};

// Authorize roles
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: `User role '${req.user.role}' is not authorized to access this route` 
      });
    }

    next();
  };
};

// Check if user is admin
const isAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
};

// Check if user is member or admin
const isMember = (req, res, next) => {
  if (!req.user || (req.user.role !== 'member' && req.user.role !== 'admin')) {
    return res.status(403).json({ message: 'Member access required' });
  }
  next();
};

// Check if user owns the resource or is admin
const isOwnerOrAdmin = (resourceUserId) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    if (req.user.role === 'admin') {
      return next();
    }

    if (req.user._id.toString() === resourceUserId.toString()) {
      return next();
    }

    return res.status(403).json({ message: 'Not authorized to access this resource' });
  };
};

module.exports = {
  protect,
  generateToken,
  optionalAuth,
  authorize,
  isAdmin,
  isMember,
  isOwnerOrAdmin
}; 