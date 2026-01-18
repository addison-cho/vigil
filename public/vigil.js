import { RealtimeVision } from 'https://esm.sh/@overshoot/sdk';

class Vigil {
    constructor() {
        console.log("Vigil initialized.");
        this.personHistory = [];
        this.alertCount = 0;
        this.vision = null;
        this.totalDetections = 0;

        this.initUI();
    }

    // UI was AI-generated
    async initUI() {
        try {
        // Load available videos
        const response = await fetch('/api/videos');
        const videos = await response.json();
        console.log('Loaded videos:', videos);
        
        const select = document.getElementById('videoSelect');
        videos.forEach(video => {
            console.log('Adding option:', video.name);
            const option = document.createElement('option');
            option.value = video.path;
            option.textContent = video.name;
            select.appendChild(option);
        }); }
        catch (error) {
            console.error('Error loading videos:', error);
            // Add a fallback option for testing
            const select = document.getElementById('videoSelect');
            const option = document.createElement('option');
            option.value = '/test-video.mp4';
            option.textContent = 'Test Video';
            select.appendChild(option);
        }
        
        // Event listeners
        const select = document.getElementById('videoSelect');
        select.addEventListener('change', (e) => {
            const video = document.getElementById('videoPlayer');
            video.src = e.target.value;
            document.getElementById('startBtn').disabled = !e.target.value;
        });
        
        document.getElementById('startBtn').addEventListener('click', () => this.start());
        document.getElementById('stopBtn').addEventListener('click', () => this.stop());
    }

    async start() {
        const videoElement = document.getElementById('videoPlayer');
        const videoPath = document.getElementById('videoSelect').value;

        if (!videoPath) return;

        // reset
        this.personHistory = [];
        this.alertCount = 0;
        this.totalDetections = 0;
        this.updateStats();
        document.getElementById('detectionFeed').innerHTML = '';

        // Fetch video file
        const response = await fetch(videoPath);
        const blob = await response.blob();
        const file = new File([blob], videoPath.split('/').pop(), { type: 'video/mp4' });
        
        // Start video
        videoElement.play();
        
        // Update UI
        document.getElementById('status').className = 'status active';
        document.getElementById('status').textContent = 'Analyzing...';
        document.getElementById('startBtn').disabled = true;
        document.getElementById('stopBtn').disabled = false;
        
        // overshoot
        this.vision = new RealtimeVision({
            apiUrl: 'https://cluster1.overshoot.ai/api/v0.2',
            apiKey: 'ovs_8a67df04b632392869c2a7a8facc37dc',
            prompt: `Return a JSON object with:
                {
                    "people": [
                    {
                        "distance": "close/medium/far",
                        "description": "brief description of clothing, height, build",
                        "notable_features": "any distinctive characteristics"
                    }
                    ],
                    "count": number of people visible behind the camera perspective
                }
                Return only valid JSON, no other text.`,
            source: { type: 'video', file: file },
            processing: {
                clip_length_seconds: 3,
                delay_seconds: 2,
                fps: 15,
                sampling_ratio: 0.2
            },
            onResult: (result) => {
                this.handleDetection(result)
            }
        })

        await this.vision.start()
        console.log("Vigil started.\n")
    }

    async stop() {
        if (this.vision) {
            await this.vision.stop();
        }
        
        document.getElementById('status').className = 'status idle';
        document.getElementById('status').textContent = 'Stopped';
        document.getElementById('startBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
        document.getElementById('videoPlayer').pause();
    }

    handleDetection(result) {
        try {
            const data = JSON.parse(result.result);
            const timestamp = new Date().toISOString();

            if (data.count > 0) {
                this.totalDetections++;

                data.people.forEach((person) => {
                    this.trackPerson(person, timestamp);
                });

                this.updateStats();
            }
        }
        catch (e) {
            console.error("Error parsing JSON:", e);
            console.log("Raw result:", result.result);
        }
    }

    trackPerson(newPerson, timestamp) {
        const match = this.personHistory.find(p => this.isSimilarPerson(p, newPerson));

        if (match) {
            // if person has already been seen before
            match.timestamps.push(timestamp);
            match.lastSeen = timestamp;
            match.distance = newPerson.distance;
            
            const count = match.timestamps.length;
            this.addLog(`  ↻ Recurring person (seen ${count}x): ${match.description}`);
            
            // Alert thresholds
            if (count === 5) {
                this.addLog(`  ⚠️  AWARENESS: Same person detected 5 times`);
            } else if (count === 15) {
                this.addLog(`  🔶 CAUTION: Same person detected 15 times`);
            } else if (count === 30) {
                this.addLog(`  🚨 ALERT: Same person detected 30 times!`);
                this.addLog(`     First seen: ${match.firstSeen}`);
                this.addLog(`     Duration: ${this.getTimeDuration(match.firstSeen, match.lastSeen)}`);
            }
        }
        else {

        const personRecord = {
            description: newPerson.description,
                notable_features: newPerson.notable_features || "none",
                distance: newPerson.distance,
                timestamps: [timestamp],
                firstSeen: timestamp,
                lastSeen: timestamp
            };
            
        this.personHistory.push(personRecord);
        this.addLog(`  + New person tracked: ${newPerson.description}`);
        }
    }

    // fix later; get rid of words like "the", "and", etc.
    isSimilarPerson(p1, p2) {
        const features1 = (p1.description || '') + ' ' + (p1.notable_features || '');
        const features2 = (p2.description || '') + ' ' + (p2.notable_features || '');
        
        const words1 = features1.toLowerCase().split(' ').filter(w => w.length > 2);
        const words2 = features2.toLowerCase().split(' ').filter(w => w.length > 2);

        const commonWords = words1.filter(word => words2.includes(word));
        return commonWords.length >= 3;
    }

    getTimeDuration(start, end) {
        const diff = new Date(end) - new Date(start);
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        
        if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        }
        return `${seconds}s`;
    }

    updateStats() {
        document.getElementById('uniquePeople').textContent = this.personHistory.length;
        document.getElementById('totalDetections').textContent = this.totalDetections;
        document.getElementById('alerts').textContent = this.alertCount;
    }

    // claude revised previous code for "clean-up"
    addLog(message, type = 'normal') {
        const feed = document.getElementById('detectionFeed');
        const item = document.createElement('div');
        item.className = `detection-item ${type}`;
        
        const time = new Date().toLocaleTimeString();
        item.innerHTML = `
            <div class="timestamp">${time}</div>
            <div>${message}</div>
        `;
        
        feed.insertBefore(item, feed.firstChild);
        
        // Keep only last 50 items
        while (feed.children.length > 50) {
            feed.removeChild(feed.lastChild);
        }
    }
}

const detector = new Vigil();
console.log('Vigil detector initialized');