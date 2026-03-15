import { jest } from '@jest/globals';

const { validateVideoRequest, validateRequestId, validateSubscription } = await import('../validation.js');

describe('Validation Middleware', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            body: {},
            params: {},
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        next = jest.fn();
    });

    // Helper to simulate express-validator flow
    // Since we are unit testing the middleware layers, we'd ideally use supertest or mock express-validator
    // But we can also test the logic by passing mock objects that express-validator expects.
    // However, testing express-validator middlewares directly in unit tests without a real express app is tricky
    // because it relies on the internal state of the request object.
    
    // For now, let's test a couple of cases and see if they work with the existing setup.
    
    describe('validateVideoRequest', () => {
        it('should be an array of middlewares', () => {
            expect(Array.isArray(validateVideoRequest)).toBe(true);
            expect(validateVideoRequest.length).toBeGreaterThan(0);
        });
    });

    describe('validateRequestId', () => {
        it('should be an array of middlewares', () => {
            expect(Array.isArray(validateRequestId)).toBe(true);
        });
    });

    describe('validateSubscription', () => {
        it('should be an array of middlewares', () => {
            expect(Array.isArray(validateSubscription)).toBe(true);
        });
    });
});
