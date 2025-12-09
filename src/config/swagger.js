const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Quran Video Generator API',
            version: '1.0.0',
            description: 'API for generating Quran video reels with synchronized audio and subtitles.',
            contact: {
                name: 'API Support',
            },
        },
        servers: [
            {
                url: 'http://localhost:5000/api/v1',
                description: 'Local server',
            },
            {
                url: 'https://quran-video-backend.onrender.com/api/v1',
                description: 'Production server',
            }
        ],
    },
    apis: ["./src/routes/*.js"], // Path to the API docs
};

export default swaggerOptions;
