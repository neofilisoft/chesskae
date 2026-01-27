const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`-----------------------------------------`);
    console.log(`Chess Game Server is running!`);
    console.log(`Open your browser at: http://localhost:${PORT}`);
    console.log(`-----------------------------------------`);
});