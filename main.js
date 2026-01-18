/*
<label>
    <input type="checkbox" id="lowLightToggle">
    🌙 Low-Light Mode (focus on silhouettes/shapes)
    </label>
*/

import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

// static files
app.use(express.static('public'));
app.use('/videos', express.static('videos'));

//.
app.get('/api/videos', (req, res) => {
    const videosDir = path.join(__dirname, 'videos');
    
    if (!fs.existsSync(videosDir)) {
        return res.json([]);
    }
    
    const files = fs.readdirSync(videosDir)
        .filter(file => file.endsWith('.mp4'))
        .map(file => ({
            name: file,
            path: `/videos/${file}`
        }));
    
    res.json(files);
});

app.listen(3000, () => {
    console.log(`Vigil server running at http://localhost:3000`);
});