import { RealtimeVision } from 'https://esm.sh/@overshoot/sdk';

/*
    'bag': ['bag', 'backpack', 'purse', 'satchel', 'pack', 'rucksack'],
    'hat': ['hat', 'cap', 'beanie', 'baseball'],
    'glasses': ['glasses', 'sunglasses', 'shades', 'spectacles'],
    'headphones': ['headphones', 'earbuds', 'earphones', 'airpods']
*/
class Vigil {
    constructor() {
        console.log("Vigil initialized.");
        this.personHistory = [];
        this.alertCount = 0;
        this.vision = null;
        this.totalDetections = 0;

        this.stopwords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'over', 'wearing', 
            'person', 'individual']);

        // Synonym groups for normalization
        this.synonymGroups = {
            // Colors - light
            'white': ['white', 'light-colored', 'light', 'pale', 'cream', 'off-white', 'ivory', 'beige'],
            'gray': ['gray', 'grey', 'charcoal', 'silver'],
            // Colors - dark
            'black': ['black', 'dark', 'dark-colored'],
            'brown': ['brown', 'tan', 'khaki'],
            // Colors - bright
            'red': ['red', 'crimson', 'maroon', 'burgundy'],
            'blue': ['blue', 'navy', 'cobalt'],
            'green': ['green', 'olive', 'forest'],
            'yellow': ['yellow', 'gold', 'golden'],
            'orange': ['orange'],
            'purple': ['purple', 'violet'],
            'pink': ['pink'],
            
            // Upper body garments
            'jacket': ['jacket', 'coat', 'hoodie', 'sweatshirt', 'sweater', 'cardigan', 'blazer'],
            'shirt': ['shirt', 'tshirt', 't-shirt', 'top', 'blouse', 'polo'],
            
            // Lower body garments
            'pants': ['pants', 'trousers', 'jeans', 'slacks', 'leggings'],
            'shorts': ['shorts'],
            'skirt': ['skirt', 'dress'],
            
            // Accessories
        };

        // ai-generated config
        this.config = {
            minMatchScore: 5,         // Points needed to consider it the same person (lowered to handle AI inconsistency)
            alertThresholds: {
                awareness: 60,
                caution: 120,
                alert: 300
            }
        };

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
            prompt: `Describe ONLY people visible. Return JSON:
                {
                    "people": [{
                        "description": "gender, upper clothing, lower clothing, accessories"
                    }],
                    "count": number
                }

                Format rules:
                - Upper clothing: "COLOR(S) GARMENT(S)" - e.g. "dark green jacket", "red hoodie over white shirt"
                - Lower clothing: "COLOR GARMENT" - e.g. "blue jeans", "black pants"  
                - Accessories: list if visible - "backpack", "headphones", "baseball cap" (omit if none)
                - Colors: be specific - "dark green" not just "dark", "light blue" not just "light"
                - ALWAYS describe both upper AND lower body clothing
                - Order: always COLOR before GARMENT ("black jacket" never "jacket black")

                Examples:
                "male, dark green puffer jacket, black pants, backpack"
                "female, red hoodie, blue jeans, headphones"`,
            source: { type: 'video', file: file },
            processing: {
                clip_length_seconds: 1,
                delay_seconds: 1,
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
            // Check if result exists and has content
            if (!result.result || result.result.trim() === '') {
                console.warn("Received empty result, skipping...");
                return;
            }

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
            console.log("Skipping this frame and continuing...");
            // Don't crash - just skip this bad result and continue
        }
    }

    trackPerson(newPerson, timestamp) {
        const match = this.personHistory.find(p => this.isSimilarPerson(p, newPerson));

        if (match) {
            match.timestamps.push(timestamp);
            match.lastSeen = timestamp;
            match.distance = newPerson.distance;
            
            const durationSeconds = this.getTimeDurationSeconds(match.firstSeen, match.lastSeen);
            const count = match.timestamps.length;
            
            this.addLog(`  ↻ Recurring person (seen ${count}x, ${this.formatDuration(durationSeconds)}): ${match.description}`);
            
            // Time-based alerts
            const thresholds = this.config.alertThresholds;
            const prevDuration = this.getTimeDurationSeconds(match.firstSeen, match.timestamps[match.timestamps.length - 2]);
            
            if (prevDuration < thresholds.awareness && durationSeconds >= thresholds.awareness) {
                this.addLog(`  ⚠️  AWARENESS: Person present for ${this.formatDuration(durationSeconds)}`);
                this.alertCount++;
            } else if (prevDuration < thresholds.caution && durationSeconds >= thresholds.caution) {
                this.addLog(`  🔶 CAUTION: Person present for ${this.formatDuration(durationSeconds)}`);
                this.alertCount++;
            } else if (prevDuration < thresholds.alert && durationSeconds >= thresholds.alert) {
                this.addLog(`  🚨 ALERT: Person present for ${this.formatDuration(durationSeconds)}!`);
                this.addLog(`     First seen: ${new Date(match.firstSeen).toLocaleTimeString()}`);
                this.alertCount++;
            }
        }
        else {
            const personRecord = {
                description: newPerson.description,
                // notable_features: newPerson.notable_features || "none",
                distance: newPerson.distance,
                timestamps: [timestamp],
                firstSeen: timestamp,
                lastSeen: timestamp
            };
                
            this.personHistory.push(personRecord);
            this.addLog(`  + New person tracked: ${newPerson.description}`);
        }
    }

    isSimilarPerson(p1, p2) {
        const features1 = (p1.description || '')
        // + ' ' + (p1.notable_features || '');
        const features2 = (p2.description || '')
        // + ' ' + (p2.notable_features || '');
        
        // Clean and tokenize WITH SYNONYM NORMALIZATION
        const words1 = this.tokenize(features1);
        const words2 = this.tokenize(features2);
        
        // Generate bigrams (2-word phrases like "white jacket")
        const bigrams1 = this.generateBigrams(words1);
        const bigrams2 = this.generateBigrams(words2);
        
        // WEIGHTED MATCHING
        let score = 0;
        const matchDetails = [];
        
        // Color + noun bigrams (high value: 2 points)
        const colors = ['white', 'black', 'gray', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown'];
        const importantNouns = ['jacket', 'shirt', 'pants', 'shorts', 'jeans', 'hoodie', 'bag', 'backpack', 'headphones', 'glasses', 'hat', 'hair'];
        
        bigrams1.forEach(bg => {
            if (bigrams2.includes(bg)) {
                const words = bg.split(' ');
                // Color + important noun = 2 points
                if (colors.includes(words[0]) && importantNouns.includes(words[1])) {
                    score += 2;
                    matchDetails.push(`${bg} (+2 color+noun)`);
                }
                // Other meaningful bigrams = 1 point
                else if (words.some(w => importantNouns.includes(w))) {
                    score += 1;
                    matchDetails.push(`${bg} (+1 clothing)`);
                } else {
                    score += 0.5;
                    matchDetails.push(`${bg} (+0.5 generic)`);
                }
            }
        });
        
        // Gender match (high value: 2 points)
        if (words1.includes('male') && words2.includes('male')) {
            score += 2;
            matchDetails.push(`male (+2 gender)`);
        } else if (words1.includes('female') && words2.includes('female')) {
            score += 2;
            matchDetails.push(`female (+2 gender)`);
        }
        
        // Single word matches for clothing types (1 point each, but don't double-count if already in bigram)
        const clothingWords = ['jacket', 'shirt', 'pants', 'shorts', 'bag', 'backpack', 'headphones'];
        const alreadyMatched = new Set(matchDetails.join(' ').split(' '));
        
        clothingWords.forEach(word => {
            if (words1.includes(word) && words2.includes(word) && !alreadyMatched.has(word)) {
                score += 1;
                matchDetails.push(`${word} (+1 clothing type)`);
            }
        });
        
        console.log(`Comparing: "${features1}" vs "${features2}"`);
        console.log(`  Words 1: [${words1.join(', ')}]`);
        console.log(`  Words 2: [${words2.join(', ')}]`);
        console.log(`  Matches: [${matchDetails.join(', ')}]`);
        console.log(`  TOTAL SCORE: ${score} (threshold: ${this.config.minMatchScore})`);
        
        if (score >= this.config.minMatchScore) {
            console.log(`  ✓ MATCH`);
            return true;
        }
        
        console.log(`  ✗ NO MATCH`);
        return false;
    }

    // Tokenize: remove stopwords, filter short words, NORMALIZE SYNONYMS
    tokenize(text) {
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, '') // Remove punctuation
            .split(/\s+/)
            .filter(w => w.length > 2 && !this.stopwords.has(w))
            .map(w => this.normalizeSynonym(w)); // ← NEW: Normalize synonyms
    }

    // Normalize a word to its canonical synonym
    normalizeSynonym(word) {
        for (const [canonical, synonyms] of Object.entries(this.synonymGroups)) {
            if (synonyms.includes(word)) {
                return canonical; // Return the canonical form (e.g., "light-colored" → "white")
            }
        }
        return word; // Return original if no synonym found
    }

    // Generate bigrams: ["tall", "man", "blue", "jacket"] → ["tall man", "man blue", "blue jacket"]
    generateBigrams(words) {
        const bigrams = [];
        for (let i = 0; i < words.length - 1; i++) {
            bigrams.push(`${words[i]} ${words[i + 1]}`);
        }
        return bigrams;
    }

    getTimeDurationSeconds(start, end) {
        return Math.floor((new Date(end) - new Date(start)) / 1000);
    }

    formatDuration(seconds) {
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