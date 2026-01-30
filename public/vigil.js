import { RealtimeVision } from 'https://esm.sh/@overshoot/sdk';
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.6.0';

class Vigil {
    constructor() {
        console.log("Vigil initialized.");
        this.personHistory = [];
        this.alertCount = 0;
        this.vision = null;
        this.embedder = null;
        this.totalDetections = 0;
        this.processingQueue = Promise.resolve();

        this.config = {
            similarityThreshold: 0.8,  // Cosine similarity threshold for matching
            alertThresholds: {
                awareness: 15,
                caution: 30,
                alert: 60
            },
            removalTimeoutSeconds: 600
        };

        this.initUI();
        this.initEmbedder();
    }

    async initEmbedder() {
        try {
            console.log("Loading CLIP embedding model...");
            this.embedder = await pipeline(
                'feature-extraction',
                'Xenova/all-MiniLM-L6-v2'
            );
            console.log("✓ Embedding model loaded");
        } catch (error) {
            console.error("Failed to load embedding model:", error);
            this.addLog("⚠️ Warning: Embedding model failed to load. Matching may not work.", 'system');
        }
    }

    async getEmbedding(text) {
        if (!this.embedder) {
            console.warn("Embedder not ready yet");
            return null;
        }
        
        const output = await this.embedder(text, {
            pooling: 'mean',
            normalize: true
        });
        
        return Array.from(output.data);
    }

    cosineSimilarity(vec1, vec2) {
        if (!vec1 || !vec2 || vec1.length !== vec2.length) {
            return 0;
        }
        
        let dotProduct = 0;
        let mag1 = 0;
        let mag2 = 0;
        
        for (let i = 0; i < vec1.length; i++) {
            dotProduct += vec1[i] * vec2[i];
            mag1 += vec1[i] * vec1[i];
            mag2 += vec2[i] * vec2[i];
        }
        
        return dotProduct / (Math.sqrt(mag1) * Math.sqrt(mag2));
    }

    extractGender(description) {
        const lower = description.toLowerCase();
        if (lower.includes('male') && !lower.includes('female')) return 'male';
        if (lower.includes('female')) return 'female';
        return 'person';
    }

    async initUI() {
        try {
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
            const select = document.getElementById('videoSelect');
            const option = document.createElement('option');
            option.value = '/test-video.mp4';
            option.textContent = 'Test Video';
            select.appendChild(option);
        }
        
        const select = document.getElementById('videoSelect');
        select.addEventListener('change', (e) => {
            const video = document.getElementById('videoPlayer');
            video.src = e.target.value;
            document.getElementById('startBtn').disabled = !e.target.value;
        });
        
        document.getElementById('startBtn').addEventListener('click', () => this.start());
        document.getElementById('stopBtn').addEventListener('click', () => this.stop());
    }

    getPrompt() {
        return `Describe EVERY human in the scene using this exact format. If none, describe none.

            Format (use this order):
            [Gender] wearing [upper body clothing with colors], [lower body clothing with colors], [accessories if visible on their body]
            Rules:
            - Gender: Use gender only on adults you are certain about ("male" or "female"). If gender is unclear or person is a child, use "person".
            - Colors: Be specific (dark green, navy blue, light beige, maroon. When figuring out colors, know that lighting may affect appearance.). 
            - Adjectives: Keep it simple and mention only if certain
            - Upper clothing: State garment type(s) and colors(s) (jacket, shirt, hoodie, cardigan)
            - Lower clothing: State garment type and color (pants, jeans, shorts, trousers)
            - Accessories: Only mention if you are confident and ONLY if the accessory is physically on the person's back or head (backpack, bag, hat, headphones)
            - Skip: hair details, facial features, shoes, exact height, patterns

            Return JSON:
            {
                "people": [{
                    "description": "follows format above"
                }],
                "count": number
            }

            Examples:
            {"people": [{"description": "Male wearing dark green hooded jacket, black pants"}], "count": 1}
            {"people": [{"description": "Female wearing brown cardigan, beige pants, white shoulder bag"}, {"description": "Person wearing light green shirt, blue shorts"}], "count": 2}
            Return ONLY valid JSON.`;
    }

    async start() {
        const videoElement = document.getElementById('videoPlayer');
        const videoPath = document.getElementById('videoSelect').value;

        if (!videoPath) return;

        // Check if embedder is ready
        if (!this.embedder) {
            this.addLog("⚠️ Waiting for embedding model to load...", 'system');
            // Wait a bit and retry
            setTimeout(() => this.start(), 2000);
            return;
        }

        this.personHistory = [];
        this.alertCount = 0;
        this.totalDetections = 0;
        this.updateStats();
        document.getElementById('detectionFeed').innerHTML = '';

        const response = await fetch(videoPath);
        const blob = await response.blob();
        const file = new File([blob], videoPath.split('/').pop(), { type: 'video/mp4' });
        
        videoElement.play();
        
        document.getElementById('status').className = 'status active';
        document.getElementById('status').textContent = 'Analyzing...';
        document.getElementById('startBtn').disabled = true;
        document.getElementById('stopBtn').disabled = false;
        
        this.vision = new RealtimeVision({
            apiUrl: 'https://cluster1.overshoot.ai/api/v0.2',
            apiKey: 'ovs_8a67df04b632392869c2a7a8facc37dc',
            prompt: this.getPrompt(),
            source: { type: 'video', file: file },
            processing: {
                clip_length_seconds: 5,
                delay_seconds: 5,
                fps: 30,
                sampling_ratio: 1
            },
            onResult: (result) => {
                this.processingQueue = this.processingQueue.then(() => this.handleDetection(result));
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
        
        this.generateEndReport();
    }

    async handleDetection(result) {
        try {
            if (!result.result || result.result.trim() === '') {
                console.warn("Received empty result, skipping...");
                return;
            }

            let cleanedResult = result.result.trim();
            cleanedResult = cleanedResult.replace(/```json\s*/g, '');
            cleanedResult = cleanedResult.replace(/```\s*/g, '');
            cleanedResult = cleanedResult.replace(/`/g, '');
            
            const jsonMatch = cleanedResult.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                cleanedResult = jsonMatch[0];
            }

            const data = JSON.parse(cleanedResult);
            const timestamp = new Date().toISOString();

            if (data.count > 0) {
                this.totalDetections++;

                for (const person of data.people) {
                    await this.trackPerson(person, timestamp);
                }

                this.updateStats();
            }
        }
        catch (e) {
            console.error("Error parsing JSON:", e);
            console.log("Raw result:", result.result);
            console.log("Skipping this frame and continuing...");
        }
    }

    async trackPerson(newPerson, timestamp) {
        // Cleanup: remove inactive people
        const timeoutSeconds = this.config.removalTimeoutSeconds;
        const currentTime = new Date(timestamp);
        
        const removedPeople = [];
        this.personHistory = this.personHistory.filter(person => {
            const lastSeenTime = new Date(person.lastSeen);
            const secondsSinceLastSeen = (currentTime - lastSeenTime) / 1000;
            
            if (secondsSinceLastSeen > timeoutSeconds) {
                const durationTracked = this.getTimeDurationSeconds(person.firstSeen, person.lastSeen);
                const detectionCount = person.timestamps.length;
                
                removedPeople.push({
                    description: person.description,
                    detectionCount,
                    durationTracked,
                    minutesSinceLastSeen: Math.floor(secondsSinceLastSeen / 60)
                });
                
                return false;
            }
            return true;
        });
        
        removedPeople.forEach(removed => {
            this.addLog(
                `  🕐 Removed from tracking (inactive ${removed.minutesSinceLastSeen}m): "${removed.description}" ` +
                `(was seen ${removed.detectionCount}x over ${this.formatDuration(removed.durationTracked)})`, 
                'system'
            );
        });

        // Get embedding for new person
        const newEmbedding = await this.getEmbedding(newPerson.description);
        if (!newEmbedding) {
            console.warn("Could not get embedding, skipping person");
            return;
        }

        const newGender = this.extractGender(newPerson.description);
        
        let bestMatch = null;
        let bestScore = 0;
        
        console.log(`\n=== Matching new person: "${newPerson.description}" ===`);
        console.log(`Currently tracking ${this.personHistory.length} people`);
        
        for (const existingPerson of this.personHistory) {
            // Skip if different gender
            if (!(existingPerson.gender == 'person' || newGender == 'person') && existingPerson.gender !== newGender) {
                console.log(`Skipping "${existingPerson.description}" - different gender`);
                continue;
            }
            
            const similarity = this.cosineSimilarity(newEmbedding, existingPerson.embedding);
            
            console.log(`Comparing: "${existingPerson.description}"`);
            console.log(`  Similarity: ${similarity.toFixed(3)}, Threshold: ${this.config.similarityThreshold}`);
            
            if (similarity >= this.config.similarityThreshold && similarity > bestScore) {
                bestMatch = existingPerson;
                bestScore = similarity;
                console.log(`  ✓ New best match! Similarity: ${bestScore.toFixed(3)}`);
            }
        }
        
        console.log(`Best match found: ${bestMatch ? 'YES (similarity: ' + bestScore.toFixed(3) + ')' : 'NO'}`);

        if (bestMatch) {
            // Update existing person
            bestMatch.timestamps.push(timestamp);
            bestMatch.lastSeen = timestamp;
            
            if (!bestMatch.allDescriptions) {
                bestMatch.allDescriptions = [bestMatch.description];
            }
            if (!bestMatch.allDescriptions.includes(newPerson.description)) {
                bestMatch.allDescriptions.push(newPerson.description);
            }
            
            const count = bestMatch.timestamps.length;
            
            // Mark as confirmed after 5+ sightings
            if (count >= 5 && bestMatch.confidence === 'tentative') {
                bestMatch.confidence = 'confirmed';
                this.addLog(`  ✓ Person confirmed after ${count} sightings`, 'system');
            }
            
            // Consolidate with other matches periodically
            if (bestMatch.confidence === 'tentative' || count % 5 === 0) {
                await this.consolidateMatches(bestMatch);
            }
            
            const durationSeconds = this.getTimeDurationSeconds(bestMatch.firstSeen, bestMatch.lastSeen);
            
            const confidenceLabel = bestMatch.confidence === 'confirmed' ? ' ✓' : '';
            this.addLog(`  ↻ Recurring person${confidenceLabel} (seen ${count}x, ${this.formatDuration(durationSeconds)})`);
            this.addLog(`     "${newPerson.description}"`);
            this.addLog(`     Similarity: ${bestScore.toFixed(3)}`);
            
            // Time-based alerts
            const thresholds = this.config.alertThresholds;
            const prevDuration = count > 1 ? this.getTimeDurationSeconds(bestMatch.firstSeen, bestMatch.timestamps[bestMatch.timestamps.length - 2]) : 0;
            
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
            // Create new person
            const personRecord = {
                description: newPerson.description,
                embedding: newEmbedding,
                gender: newGender,
                timestamps: [timestamp],
                firstSeen: timestamp,
                lastSeen: timestamp,
                allDescriptions: [newPerson.description],
                confidence: 'tentative'
            };
                
            this.personHistory.push(personRecord);
            this.addLog(`  + New person tracked (tentative): ${newPerson.description}`);
        }
    }

    async consolidateMatches(targetPerson) {
        const toRemove = [];
        
        for (let i = 0; i < this.personHistory.length; i++) {
            const otherPerson = this.personHistory[i];
            
            // Skip self and different genders
            if (otherPerson === targetPerson || otherPerson.gender !== targetPerson.gender) {
                continue;
            }
            
            const similarity = this.cosineSimilarity(targetPerson.embedding, otherPerson.embedding);
            
            if (similarity >= this.config.similarityThreshold) {
                // Merge other person into target
                targetPerson.timestamps.push(...otherPerson.timestamps);
                
                if (new Date(otherPerson.firstSeen) < new Date(targetPerson.firstSeen)) {
                    targetPerson.firstSeen = otherPerson.firstSeen;
                }
                
                if (new Date(otherPerson.lastSeen) > new Date(targetPerson.lastSeen)) {
                    targetPerson.lastSeen = otherPerson.lastSeen;
                }
                
                if (otherPerson.allDescriptions) {
                    targetPerson.allDescriptions = [
                        ...new Set([...targetPerson.allDescriptions, ...otherPerson.allDescriptions])
                    ];
                }
                
                toRemove.push(i);
                
                this.addLog(
                    `  🔗 Consolidated: merged "${otherPerson.description}" ` +
                    `(${otherPerson.timestamps.length} detections, similarity: ${similarity.toFixed(3)}) into main track`,
                    'system'
                );
            }
        }
        
        // Remove consolidated entries (reverse order to preserve indices)
        for (let i = toRemove.length - 1; i >= 0; i--) {
            this.personHistory.splice(toRemove[i], 1);
        }
        
        if (toRemove.length > 0) {
            targetPerson.timestamps.sort((a, b) => new Date(a) - new Date(b));
            targetPerson.confidence = 'confirmed';
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
        const confirmed = this.personHistory.filter(p => p.confidence === 'confirmed').length;
        const tentative = this.personHistory.filter(p => p.confidence === 'tentative').length;
        
        let displayHTML = `${this.personHistory.length}`;
        if (tentative > 0) {
            displayHTML += `<div style="font-size: 0.8em; color: #888; margin-top: 3px;">(${tentative} tentative)</div>`;
        }
        
        document.getElementById('uniquePeople').innerHTML = displayHTML;
        document.getElementById('totalDetections').textContent = this.totalDetections;
        document.getElementById('alerts').textContent = this.alertCount;
    }

    generateEndReport() {
        console.log("\n========== VIGIL SESSION REPORT ==========");
        console.log(`Total unique people tracked: ${this.personHistory.length}`);
        console.log(`Total detections: ${this.totalDetections}`);
        console.log(`Alerts triggered: ${this.alertCount}`);
        console.log("\n--- UNIQUE PEOPLE DETECTED ---\n");
        
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
            console.log(`  Gender: ${person.gender}`);
            console.log(`  Confidence: ${person.confidence || 'N/A'}`);
            
            if (person.allDescriptions && person.allDescriptions.length > 1) {
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
        
        this.addLog(`\n========== SESSION COMPLETE ==========`, 'report');
        this.addLog(`${this.personHistory.length} unique people | ${this.totalDetections} total detections | ${this.alertCount} alerts`, 'report');
        
        sortedPeople.forEach((person, index) => {
            const duration = this.getTimeDurationSeconds(person.firstSeen, person.lastSeen);
            const detectionCount = person.timestamps.length;
            const label = person.confidence === 'confirmed' ? ' ✓' : ' ?';
            this.addLog(`Person #${index + 1}: "${person.description}"${label} (${detectionCount}x, ${this.formatDuration(duration)})`, 'report');
        });
    }

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
        
        while (feed.children.length > 100) {
            feed.removeChild(feed.lastChild);
        }
    }
}

const detector = new Vigil();
console.log('Vigil detector initialized');