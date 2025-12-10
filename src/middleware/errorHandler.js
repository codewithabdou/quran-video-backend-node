import { AppError } from '../utils/errors.js';

/**
 * Global error handling middleware
 * Should be placed after all routes
 */
export const errorHandler = (err, req, res, next) => {
    // Log error for debugging
    console.error('Error occurred:', {
        name: err.name,
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        timestamp: new Date().toISOString(),
        path: req.path,
        method: req.method,
    });

    // Default error values
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Internal Server Error';
    let details = err.details || null;

    // Handle specific error types
    if (err.name === 'ValidationError') {
        statusCode = 400;
        message = err.message;
        details = err.details;
    } else if (err.name === 'CastError') {
        statusCode = 400;
        message = 'Invalid data format';
    } else if (err.code === 'ENOENT') {
        statusCode = 404;
        message = 'File not found';
    } else if (err.code === 'EACCES' || err.code === 'EPERM') {
        statusCode = 500;
        message = 'Permission denied';
    }

    // Don't leak error details in production for non-operational errors
    if (!err.isOperational && process.env.NODE_ENV === 'production') {
        message = 'An unexpected error occurred';
        details = null;
    }

    // Send error response
    res.status(statusCode).json({
        error: {
            message,
            ...(details && { details }),
            ...(process.env.NODE_ENV === 'development' && {
                stack: err.stack,
                name: err.name,
            }),
        },
    });
};

/**
 * Async error wrapper for route handlers
 * Catches async errors and passes them to error middleware
 */
export const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

/**
 * 404 Not Found handler
 * Should be placed before error handler middleware
 */
export const notFoundHandler = (req, res, next) => {
    const error = new AppError(`Route not found: ${req.originalUrl}`, 404);
    next(error);
};
