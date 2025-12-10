/**
 * Retry utility with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {Object} options - Retry options
 * @returns {Promise} - Result of the function
 */
export async function retryWithBackoff(fn, options = {}) {
    const {
        maxRetries = 3,
        initialDelay = 1000,
        maxDelay = 10000,
        backoffMultiplier = 2,
        onRetry = null,
        shouldRetry = (error) => true,
    } = options;

    let lastError;
    let delay = initialDelay;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // Don't retry if this is the last attempt or if shouldRetry returns false
            if (attempt === maxRetries || !shouldRetry(error)) {
                throw error;
            }

            // Call onRetry callback if provided
            if (onRetry) {
                onRetry(attempt + 1, maxRetries, error, delay);
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delay));

            // Increase delay for next retry (exponential backoff)
            delay = Math.min(delay * backoffMultiplier, maxDelay);
        }
    }

    throw lastError;
}

/**
 * Retry specifically for HTTP requests
 * @param {Function} requestFn - Async function that makes HTTP request
 * @param {Object} options - Retry options
 * @returns {Promise} - Response from the request
 */
export async function retryHttpRequest(requestFn, options = {}) {
    const defaultOptions = {
        maxRetries: 3,
        initialDelay: 1000,
        shouldRetry: (error) => {
            // Retry on network errors or 5xx server errors
            if (!error.response) return true; // Network error
            const status = error.response?.status;
            return status >= 500 && status < 600;
        },
        onRetry: (attempt, maxRetries, error, delay) => {
            console.log(`HTTP request failed (attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms...`);
            console.log(`Error: ${error.message}`);
        },
    };

    return retryWithBackoff(requestFn, { ...defaultOptions, ...options });
}

/**
 * Retry for file operations
 * @param {Function} fileOpFn - Async function that performs file operation
 * @param {Object} options - Retry options
 * @returns {Promise} - Result of file operation
 */
export async function retryFileOperation(fileOpFn, options = {}) {
    const defaultOptions = {
        maxRetries: 5,
        initialDelay: 500,
        shouldRetry: (error) => {
            // Retry on EBUSY, EPERM, EACCES errors
            return ['EBUSY', 'EPERM', 'EACCES'].includes(error.code);
        },
        onRetry: (attempt, maxRetries, error, delay) => {
            console.log(`File operation failed (attempt ${attempt}/${maxRetries}). Retrying in ${delay}ms...`);
            console.log(`Error: ${error.message}`);
        },
    };

    return retryWithBackoff(fileOpFn, { ...defaultOptions, ...options });
}
