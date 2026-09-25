import { describe, it, expect } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import versesRoutes from '../versesRoutes.js';
import { errorHandler } from '../../middleware/errorHandler.js';

const app = express();
app.use(express.json());
app.use('/api/v1', versesRoutes);
app.use(errorHandler);

describe('Verses Routes', () => {
    describe('GET /api/v1/verses/surahs', () => {
        it('should return all 114 surahs', async () => {
            const res = await request(app).get('/api/v1/verses/surahs');
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('success');
            expect(res.body.data.surahs).toHaveLength(114);
            expect(res.body.data.surahs[0].number).toBe(1);
        });
    });

    describe('GET /api/v1/verses/search', () => {
        it('should return search results for a reference query', async () => {
            const res = await request(app).get('/api/v1/verses/search?q=2:255');
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('success');
            expect(res.body.data.total).toBe(1);
            expect(res.body.data.results[0].surah).toBe(2);
            expect(res.body.data.results[0].numberInSurah).toBe(255);
        });

        it('should return search results for an Arabic keyword', async () => {
            const res = await request(app).get('/api/v1/verses/search').query({ q: 'الرحمن الرحيم' });
            expect(res.status).toBe(200);
            expect(res.body.data.total).toBeGreaterThan(0);
        });

        it('should reject search with empty query', async () => {
            const res = await request(app).get('/api/v1/verses/search?q=');
            expect(res.status).toBe(400);
        });
    });

    describe('GET /api/v1/verses', () => {
        it('should return exact contiguous ayahs for a valid range', async () => {
            const res = await request(app).get('/api/v1/verses?surah=1&start=1&end=3');
            expect(res.status).toBe(200);
            expect(res.body.status).toBe('success');
            expect(res.body.data.ayahs).toHaveLength(3);
            expect(res.body.data.ayahs[0].numberInSurah).toBe(1);
            expect(res.body.data.ayahs[2].numberInSurah).toBe(3);
        });

        it('should reject range exceeding surah ayah count', async () => {
            const res = await request(app).get('/api/v1/verses?surah=1&start=1&end=10');
            expect(res.status).toBe(400);
        });

        it('should reject invalid surah number', async () => {
            const res = await request(app).get('/api/v1/verses?surah=150&start=1&end=2');
            expect(res.status).toBe(400);
        });
    });
});
