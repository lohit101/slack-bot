require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// middleware
app.use(express.json());

// test route
app.get('/', (req, res) => {
    res.send('Bot is running!');
});

// start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
