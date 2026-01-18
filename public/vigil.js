import { RealtimeVision } from 'https://esm.sh/@overshoot/sdk';
import { DescAnalyzer } from './language.js';

class Vigil {
    constructor() {
        console.log("Vigil initialized.");
        this.personHistory = [];
        this.alertCount = 0;
        this.vision = null;
        this.totalDetections = 0;

        // Initialize the compound matcher
        this.analyzer = new DescAnalyzer({
            minMatchScore: 5
        });

        // ai-generated config
        this.config = {
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
            }); 
        }
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
        
        // Low-light mode toggle
        const lowLightToggle = document.getElementById('lowLightToggle');
        if (lowLightToggle) {
            lowLightToggle.addEventListener('change', (e) => {
                this.analyzer.setLowLightMode(e.target.checked);
                this.addLog(`${e.target.checked ? '🌙 Low-light mode: Focusing on build/shape/accessories' : '☀️ Normal mode: Focusing on colors/garments'}`, 'system');
            });
        }
    }

    getPromptForMode() {
        if (this.analyzer.lowLightMode) {
            // LOW-LIGHT MODE: Focus on silhouettes + basic light/dark colors
            return `Describe ONLY people visible in this low-light/nighttime footage. Return JSON:
{
    "people": [{
        "description": "build, overall color tone, garment shapes, accessories"
    }],
    "count": number
}

IMPORTANT - Low-light conditions:
- Build: "tall", "short", "large build", "small build", "medium build"
- Overall color: Use ONLY "light colored" OR "dark colored" for clothing (don't try to identify specific colors like blue/green)
- Garment SHAPES: "puffy coat", "fitted jacket", "long coat", "loose hoodie", "baggy pants"
- Accessories: "backpack", "bag", "headphones", "hat", "cap"

Examples:
✓ {"people": [{"description": "tall, dark colored puffy coat, backpack"}], "count": 1}
✓ {"people": [{"description": "small build, light colored long coat, headphones"}], "count": 1}
✓ {"people": [{"description": "medium build, dark colored fitted jacket, dark pants"}], "count": 1}`;
        } else {
            // NORMAL MODE: Colors and details
            return `Describe ONLY people visible. Return JSON:
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
- Return ONLY the JSON object, no markdown code blocks, no backticks, no additional text

Examples:
✓ {"people": [{"description": "male, dark green puffer jacket, black pants, backpack"}], "count": 1}
✓ {"people": [{"description": "female, red hoodie, blue jeans, headphones"}], "count": 1}`;
        }
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
            prompt: this.getPromptForMode(),
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
        
        // Generate end report
        this.generateEndReport();
    }

    handleDetection(result) {
        try {
            // Check if result exists and has content
            if (!result.result || result.result.trim() === '') {
                console.warn("Received empty result, skipping...");
                return;
            }

            // Clean the result - remove markdown code blocks if present
            let cleanedResult = result.result.trim();
            
            // Remove markdown code fences (```json and ```)
            cleanedResult = cleanedResult.replace(/```json\s*/g, '');
            cleanedResult = cleanedResult.replace(/```\s*/g, '');
            
            // Remove any stray backticks
            cleanedResult = cleanedResult.replace(/`/g, '');
            
            // Try to find JSON object if there's surrounding text
            const jsonMatch = cleanedResult.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                cleanedResult = jsonMatch[0];
            }

            const data = JSON.parse(cleanedResult);
            const timestamp = new Date().toISOString();

            if (data.count > 0) {
                this.totalDetections++;

                data.people.forEach((person) => {
                    // Check if description is too vague to be useful
                    const specificityScore = this.getDescriptionSpecificity(person.description);
                    
                    if (specificityScore < 2) {
                        // Track as generic silhouette instead
                        this.trackSilhouette(person, timestamp);
                    } else {
                        this.trackPerson(person, timestamp);
                    }
                });

                this.updateStats();
            }
        }
        catch (e) {
            console.error("Error parsing JSON:", e);
            console.log("Raw result:", result.result);
            console.log("Attempted to parse:", result.result.substring(0, 200));
            console.log("Skipping this frame and continuing...");
            // Don't crash - just skip this bad result and continue
        }
    }
    
    getDescriptionSpecificity(description) {
        const normalized = description.toLowerCase();
        let specificityScore = 0;
        
        // Specific colors (not just dark/light) add points
        const specificColors = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'white', 'gray', 'brown'];
        for (const color of specificColors) {
            if (normalized.includes(color)) specificityScore += 2;
        }
        
        // Accessories add points (very distinctive)
        const accessories = ['backpack', 'bag', 'headphones', 'glasses', 'hat', 'cap', 'beanie'];
        for (const accessory of accessories) {
            if (normalized.includes(accessory)) specificityScore += 3;
        }
        
        // Specific garment types add points
        const specificGarments = ['puffer', 'puffy', 'hoodie', 'sweater', 'jeans', 'shorts'];
        for (const garment of specificGarments) {
            if (normalized.includes(garment)) specificityScore += 1;
        }
        
        // Build descriptors add points in low-light mode
        if (this.analyzer.lowLightMode) {
            const builds = ['tall', 'short', 'large', 'small', 'slim', 'stocky'];
            for (const build of builds) {
                if (normalized.includes(build)) specificityScore += 2;
            }
        }
        
        return specificityScore;
    }
    
    trackSilhouette(newPerson, timestamp) {
        // Find or create the generic silhouette tracker
        let silhouette = this.personHistory.find(p => p.isSilhouette);
        
        if (!silhouette) {
            silhouette = {
                description: "👤 Unidentifiable silhouette/figure",
                isSilhouette: true,
                timestamps: [],
                firstSeen: timestamp,
                lastSeen: timestamp,
                allDescriptions: [],
                vagueDescriptions: []
            };
            this.personHistory.push(silhouette);
            this.addLog(`  👤 Created silhouette tracker for vague detections`);
        }
        
        // Update silhouette tracking
        silhouette.timestamps.push(timestamp);
        silhouette.lastSeen = timestamp;
        
        // Store the vague description
        if (!silhouette.vagueDescriptions.includes(newPerson.description)) {
            silhouette.vagueDescriptions.push(newPerson.description);
        }
        
        const durationSeconds = this.getTimeDurationSeconds(silhouette.firstSeen, silhouette.lastSeen);
        const count = silhouette.timestamps.length;
        
        this.addLog(`  👤 Silhouette detected (${count}x, ${this.formatDuration(durationSeconds)}): "${newPerson.description}"`);
        
        // Time-based alerts for silhouette
        const thresholds = this.config.alertThresholds;
        const prevDuration = count > 1 ? this.getTimeDurationSeconds(silhouette.firstSeen, silhouette.timestamps[silhouette.timestamps.length - 2]) : 0;
        
        if (prevDuration < thresholds.awareness && durationSeconds >= thresholds.awareness) {
            this.addLog(`  ⚠️  AWARENESS: Unidentifiable figure present for ${this.formatDuration(durationSeconds)}`);
            this.alertCount++;
        } else if (prevDuration < thresholds.caution && durationSeconds >= thresholds.caution) {
            this.addLog(`  🔶 CAUTION: Unidentifiable figure present for ${this.formatDuration(durationSeconds)}`);
            this.alertCount++;
        } else if (prevDuration < thresholds.alert && durationSeconds >= thresholds.alert) {
            this.addLog(`  🚨 ALERT: Unidentifiable figure present for ${this.formatDuration(durationSeconds)}!`);
            this.addLog(`     First seen: ${new Date(silhouette.firstSeen).toLocaleTimeString()}`);
            this.alertCount++;
        }
    }

    trackPerson(newPerson, timestamp) {
        // Remove people not seen in 10 minutes (600 seconds)
        const now = new Date(timestamp);
        this.personHistory = this.personHistory.filter(person => {
            const lastSeenTime = new Date(person.lastSeen);
            const secondsSinceLastSeen = (now - lastSeenTime) / 1000;
            
            if (secondsSinceLastSeen > 600) {
                this.addLog(`  🕐 Removed from tracking (not seen for ${Math.floor(secondsSinceLastSeen / 60)}m): "${person.description}"`, 'system');
                return false;
            }
            return true;
        });
        
        // Use the compound matcher to find similar person
        let bestMatch = null;
        let bestScore = 0;
        
        for (const existingPerson of this.personHistory) {
            const matchResult = this.analyzer.matchScore(
                existingPerson.description, 
                newPerson.description
            );
            
            if (matchResult.matched && matchResult.score > bestScore) {
                bestMatch = existingPerson;
                bestScore = matchResult.score;
            }
        }

        if (bestMatch) {
            bestMatch.timestamps.push(timestamp);
            bestMatch.lastSeen = timestamp;
            
            // Store all descriptions seen for this person
            if (!bestMatch.allDescriptions) {
                bestMatch.allDescriptions = [bestMatch.description];
            }
            if (!bestMatch.allDescriptions.includes(newPerson.description)) {
                bestMatch.allDescriptions.push(newPerson.description);
            }
            
            const durationSeconds = this.getTimeDurationSeconds(bestMatch.firstSeen, bestMatch.lastSeen);
            const count = bestMatch.timestamps.length;
            
            // Get detailed match breakdown
            const matchResult = this.analyzer.matchScore(bestMatch.description, newPerson.description);
            const breakdownStr = this.analyzer.formatBreakdown(matchResult.breakdown);
            
            this.addLog(`  ↻ Recurring person (seen ${count}x, ${this.formatDuration(durationSeconds)})`);
            this.addLog(`     Original: "${bestMatch.description}"`);
            this.addLog(`     Current:  "${newPerson.description}"`);
            this.addLog(`     Match: score=${matchResult.score.toFixed(1)} [${breakdownStr}]`);
            
            // Time-based alerts
            const thresholds = this.config.alertThresholds;
            const prevDuration = this.getTimeDurationSeconds(bestMatch.firstSeen, bestMatch.timestamps[bestMatch.timestamps.length - 2]);
            
            if (prevDuration < thresholds.awareness && durationSeconds >= thresholds.awareness) {
                this.addLog(`  ⚠️  AWARENESS: Person present for ${this.formatDuration(durationSeconds)}`);
                this.alertCount++;
            } else if (prevDuration < thresholds.caution && durationSeconds >= thresholds.caution) {
                this.addLog(`  🔶 CAUTION: Person present for ${this.formatDuration(durationSeconds)}`);
                this.alertCount++;
            } else if (prevDuration < thresholds.alert && durationSeconds >= thresholds.alert) {
                this.addLog(`  🚨 ALERT: Person present for ${this.formatDuration(durationSeconds)}!`);
                this.addLog(`     First seen: ${new Date(bestMatch.firstSeen).toLocaleTimeString()}`);
                this.alertCount++;
            }
        }
        else {
            const personRecord = {
                description: newPerson.description,
                timestamps: [timestamp],
                firstSeen: timestamp,
                lastSeen: timestamp,
                allDescriptions: [newPerson.description]
            };
                
            this.personHistory.push(personRecord);
            this.addLog(`  + New person tracked: ${newPerson.description}`);
        }
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

    generateEndReport() {
        console.log("\n========== VIGIL SESSION REPORT ==========");
        console.log(`Total unique people tracked: ${this.personHistory.length}`);
        console.log(`Total detections: ${this.totalDetections}`);
        console.log(`Alerts triggered: ${this.alertCount}`);
        console.log("\n--- UNIQUE PEOPLE DETECTED ---\n");
        
        // Sort by duration (longest first)
        const sortedPeople = [...this.personHistory].sort((a, b) => {
            const durationA = this.getTimeDurationSeconds(a.firstSeen, a.lastSeen);
            const durationB = this.getTimeDurationSeconds(b.firstSeen, b.lastSeen);
            return durationB - durationA;
        });
        
        sortedPeople.forEach((person, index) => {
            const duration = this.getTimeDurationSeconds(person.firstSeen, person.lastSeen);
            const detectionCount = person.timestamps.length;
            
            console.log(`Person #${index + 1}:`);
            console.log(`  Primary description: "${person.description}"`);
            
            if (person.isSilhouette && person.vagueDescriptions && person.vagueDescriptions.length > 0) {
                console.log(`  Vague descriptions captured:`);
                person.vagueDescriptions.forEach(desc => {
                    console.log(`    - "${desc}"`);
                });
            } else if (person.allDescriptions && person.allDescriptions.length > 1) {
                console.log(`  All descriptions seen:`);
                person.allDescriptions.forEach(desc => {
                    console.log(`    - "${desc}"`);
                });
            }
            
            console.log(`  Detected ${detectionCount} times over ${this.formatDuration(duration)}`);
            console.log(`  First seen: ${new Date(person.firstSeen).toLocaleTimeString()}`);
            console.log(`  Last seen: ${new Date(person.lastSeen).toLocaleTimeString()}`);
            console.log("");
        });
        
        console.log("==========================================\n");
        
        // Also add to UI
        this.addLog(`\n========== SESSION COMPLETE ==========`, 'report');
        this.addLog(`${this.personHistory.length} unique people | ${this.totalDetections} total detections | ${this.alertCount} alerts`, 'report');
        
        sortedPeople.forEach((person, index) => {
            const duration = this.getTimeDurationSeconds(person.firstSeen, person.lastSeen);
            const detectionCount = person.timestamps.length;
            const label = person.isSilhouette ? ' [SILHOUETTE]' : '';
            this.addLog(`Person #${index + 1}: "${person.description}"${label} (${detectionCount}x, ${this.formatDuration(duration)})`, 'report');
        });
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
        
        // Keep only last 100 items (increased for better session history)
        while (feed.children.length > 100) {
            feed.removeChild(feed.lastChild);
        }
    }
}

const detector = new Vigil();
console.log('Vigil detector initialized');