import { RealtimeVision } from 'https://esm.sh/@overshoot/sdk';
import { DescAnalyzer } from './language.js';

class Vigil {
    constructor() {
        console.log("Vigil initialized.");
        this.personHistory = [];
        this.alertCount = 0;
        this.vision = null;
        this.totalDetections = 0;
        this.processingQueue = Promise.resolve();

        this.analyzer = new DescAnalyzer({
            minMatchScore: 4.7
        });

        this.config = {
            alertThresholds: {
                awareness: 15,
                caution: 30,
                alert: 60
            },
            removalTimeoutSeconds: 600
        };

        this.initUI();
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
        return `Describe ONLY people visible. Return JSON:
        {
            "people": [{
                "description": "gender, upper clothing, lower clothing, worn accessories"
            }],
            "count": number
        }

        VERY IMPORTANT: Do NOT write "child."

        CRITICAL COLOR RULES:
        - ALWAYS identify specific colors, even if dark/dim: "dark green", "dark blue", "dark gray", "navy", etc.
        - NEVER use just "dark" or "light" or "light-colored" alone - always include the actual color
        - In extreme uncertainty, you can use "dark"
        - Common colors in dim light: dark green, dark blue, navy, charcoal, gray, brown, maroon

        Format rules:
        - Upper clothing: "COLOR(S) GARMENT(S)" - e.g. "dark green jacket", "red hoodie over white shirt"
        - Lower clothing: "COLOR GARMENT" - e.g. "blue jeans", "black pants"  
        - Accessories: list if visible and being worn - "backpack", "headphones", "baseball cap" (omit if none)
        - Colors: be specific - "dark green" not just "dark", "light blue" not just "light"
        - ALWAYS describe both upper AND lower body clothing
        - Order: always COLOR before GARMENT ("black jacket" never "jacket black")
        - Return ONLY the JSON object, no markdown code blocks, no backticks, no additional text

        Examples:
        {"people": [{"description": "male, dark green puffer jacket, black pants, backpack"}], "count": 1}
        {"people": [{"description": "female, red hoodie, blue jeans, headphones"}], "count": 1}`;
    }

    async start() {
        const videoElement = document.getElementById('videoPlayer');
        const videoPath = document.getElementById('videoSelect').value;

        if (!videoPath) return;

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
                clip_length_seconds: 3,
                delay_seconds: 3,
                fps: 15,
                sampling_ratio: 0.1
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

    handleDetection(result) {
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

                data.people.forEach((person) => {
                    const specificityScore = this.getDescriptionSpecificity(person.description);
                    
                    if (specificityScore < 2) {
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
        }
    }
    
    getDescriptionSpecificity(description) {
        const normalized = description.toLowerCase();
        let specificityScore = 0;
        
        const specificColors = ['black', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'white', 'gray', 'brown'];
        for (const color of specificColors) {
            if (normalized.includes(color)) specificityScore += 2;
        }
        
        const accessories = ['backpack', 'bag', 'headphones', 'glasses', 'hat', 'cap', 'beanie'];
        for (const accessory of accessories) {
            if (normalized.includes(accessory)) specificityScore += 3;
        }
        
        const specificGarments = ['puffer', 'puffy', 'hoodie', 'sweater', 'jeans', 'shorts'];
        for (const garment of specificGarments) {
            if (normalized.includes(garment)) specificityScore += 1;
        }

        if (normalized.includes('female') || normalized.includes('male')) {
            specificityScore += 1;
        }
        
        return specificityScore;
    }
    
    trackSilhouette(newPerson, timestamp) {
        let silhouette = this.personHistory.find(p => p.isSilhouette);
        
        if (!silhouette) {
            silhouette = {
                description: "👤 Unidentifiable silhouette/figure",
                isSilhouette: true,
                timestamps: [],
                firstSeen: timestamp,
                lastSeen: timestamp,
                allDescriptions: [],
                vagueDescriptions: [],
                confidence: 'silhouette'
            };
            this.personHistory.push(silhouette);
            this.addLog(`  👤 Created silhouette tracker for vague detections`);
        }
        
        silhouette.timestamps.push(timestamp);
        silhouette.lastSeen = timestamp;
        
        if (!silhouette.vagueDescriptions.includes(newPerson.description)) {
            silhouette.vagueDescriptions.push(newPerson.description);
        }
        
        const durationSeconds = this.getTimeDurationSeconds(silhouette.firstSeen, silhouette.lastSeen);
        const count = silhouette.timestamps.length;
        
        this.addLog(`  👤 Silhouette detected (${count}x, ${this.formatDuration(durationSeconds)}): "${newPerson.description}"`);
        
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
        
        let bestMatch = null;
        let bestScore = 0;
        
        console.log(`\n=== Matching new person: "${newPerson.description}" ===`);
console.log(`Currently tracking ${this.personHistory.length} people`);

for (const existingPerson of this.personHistory) {
    if (existingPerson.isSilhouette) continue;
    
    // ADD THIS:
    console.log(`\n--- Testing against: "${existingPerson.description}" ---`);
    
    const matchResult = this.analyzer.matchScore(
        existingPerson.description, 
        newPerson.description
    );
    
    // ADD THIS:
    console.log(`FULL RESULT:`, matchResult);
    console.log(`Words1:`, matchResult.details.words1);
    console.log(`Words2:`, matchResult.details.words2);
    console.log(`Bigrams1:`, matchResult.details.bigrams1);
    console.log(`Bigrams2:`, matchResult.details.bigrams2);
    console.log(`Breakdown:`, this.analyzer.formatBreakdown(matchResult.breakdown));}

    // debugging end
        
        for (const existingPerson of this.personHistory) {
            if (existingPerson.isSilhouette) continue;
            
            const matchResult = this.analyzer.matchScore(
                existingPerson.description, 
                newPerson.description
            );
            
            if (matchResult.score > 3) {
                console.log(`Comparing: "${existingPerson.description}"`);
                console.log(`  Score: ${matchResult.score.toFixed(1)}, Matched: ${matchResult.matched}, Threshold: ${matchResult.threshold}`);
                console.log(`  Breakdown:`, this.analyzer.formatBreakdown(matchResult.breakdown));
            }
            
            if (matchResult.matched && matchResult.score > bestScore) {
                bestMatch = existingPerson;
                bestScore = matchResult.score;
                console.log(`  ✓ New best match! Score: ${bestScore.toFixed(1)}`);
            }
        }
        
        console.log(`Best match found: ${bestMatch ? 'YES (score: ' + bestScore.toFixed(1) + ')' : 'NO'}`);

        if (bestMatch) {
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
            
            // Consolidate with other matches (only for tentative people to save cycles)
            if (bestMatch.confidence === 'tentative' || count % 5 === 0) {
                this.consolidateMatches(bestMatch);
            }
            
            const durationSeconds = this.getTimeDurationSeconds(bestMatch.firstSeen, bestMatch.lastSeen);
            
            const matchResult = this.analyzer.matchScore(bestMatch.description, newPerson.description);
            const breakdownStr = this.analyzer.formatBreakdown(matchResult.breakdown);
            
            const confidenceLabel = bestMatch.confidence === 'confirmed' ? ' ✓' : '';
            this.addLog(`  ↻ Recurring person${confidenceLabel} (seen ${count}x, ${this.formatDuration(durationSeconds)})`);
            this.addLog(`"${newPerson.description}"`);
            // this.addLog(`     Match: score=${matchResult.score.toFixed(1)} [${breakdownStr}]`);
            // over here
            
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
            const personRecord = {
                description: newPerson.description,
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

    consolidateMatches(targetPerson) {
        const toRemove = [];
        
        for (let i = 0; i < this.personHistory.length; i++) {
            const otherPerson = this.personHistory[i];
            
            if (otherPerson === targetPerson || otherPerson.isSilhouette) continue;
            
            const matchResult = this.analyzer.matchScore(
                targetPerson.description,
                otherPerson.description
            );
            
            if (matchResult.matched) {
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
                    `(${otherPerson.timestamps.length} detections) into main track`,
                    'system'
                );
            }
        }
        
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
            console.log(`  Confidence: ${person.confidence || 'N/A'}`);
            
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
        
        this.addLog(`\n========== SESSION COMPLETE ==========`, 'report');
        this.addLog(`${this.personHistory.length} unique people | ${this.totalDetections} total detections | ${this.alertCount} alerts`, 'report');
        
        sortedPeople.forEach((person, index) => {
            const duration = this.getTimeDurationSeconds(person.firstSeen, person.lastSeen);
            const detectionCount = person.timestamps.length;
            const label = person.isSilhouette ? ' [SILHOUETTE]' : person.confidence === 'confirmed' ? ' ✓' : ' ?';
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