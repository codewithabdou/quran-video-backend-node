/**
 * Custom error classes for better error handling
 */

export class AppError extends Error {
    constructor(message, statusCode = 500, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.timestamp = new Date().toISOString();
        Error.captureStackTrace(this, this.constructor);
    }
}

export class ValidationError extends AppError {
    constructor(message, details = null) {
        super(message, 400);
        this.name = 'ValidationError';
        this.details = details;
    }
}

export class NotFoundError extends AppError {
    constructor(resource = 'Resource') {
        super(`${resource} not found`, 404);
        this.name = 'NotFoundError';
    }
}

export class ExternalAPIError extends AppError {
    constructor(service, originalError) {
        super(`External API error: ${service}`, 502);
        this.name = 'ExternalAPIError';
        this.service = service;
        this.originalError = originalError?.message || originalError;
    }
}

export class VideoGenerationError extends AppError {
    constructor(message, stage = 'unknown') {
        super(message, 500);
        this.name = 'VideoGenerationError';
        this.stage = stage;
    }
}

export class FileOperationError extends AppError {
    constructor(operation, filePath, originalError) {
        super(`File ${operation} failed: ${filePath}`, 500);
        this.name = 'FileOperationError';
        this.operation = operation;
        this.filePath = filePath;
        this.originalError = originalError?.message || originalError;
    }
}
