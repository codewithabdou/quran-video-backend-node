import { jest } from '@jest/globals';

const {
    validateVideoRequest,
    validateRequestId,
    validateSubscription,
    validateSearchQuery,
    validateVersesQuery,
    validatePlanRequest,
} = await import('../validation.js');

describe('Validation Middleware', () => {
    let req, res, next;

    beforeEach(() => {
        req = {
            body: {},
            params: {},
            query: {},
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn(),
        };
        next = jest.fn();
    });

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

    describe('validateSearchQuery', () => {
        it('should be an array of middlewares', () => {
            expect(Array.isArray(validateSearchQuery)).toBe(true);
        });
    });

    describe('validateVersesQuery', () => {
        it('should be an array of middlewares', () => {
            expect(Array.isArray(validateVersesQuery)).toBe(true);
        });
    });

    describe('validatePlanRequest', () => {
        it('should be an array of middlewares', () => {
            expect(Array.isArray(validatePlanRequest)).toBe(true);
        });
    });
});

