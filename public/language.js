// preprocess text (dark green puffer jacket -> dark-green puffer-jacket)
// tokenize (dark-green, puffer-jacket)
// compound matcher (synonyms, compounds, etc)
// matchScore(desc1, desc2)

export class DescAnalyzer {
    constructor(config={}) {
        this.minMatchScore = config.minMatchScore || 5;

        // words were AI-generated
        // sets were designed and prompted by me

        this.stopwords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in',
                                'on', 'at', 'to', 'for', 'of', 'with', 'by',
                                'from', 'up', 'about', 'into', 'through',
                                'during', 'over', 'wearing',
                                'long', 'short']); // added this to remove the chance of two adjectives

        this.colorModifiers = new Set(['dark', 'light', 'bright', 'pale', 'deep', 'vivid']);
        this.garmentModifiers = new Set(['puffer', 'hooded', 'denim', 'leather',
                                        'baseball', 'running', 'cargo', 'skinny',
                                        'zip', 'button', 'long', 'short']);

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
        };

        // key categories for weighing matches
        this.colors = new Set(['white', 'black', 'gray', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown']);
        this.importantNouns = new Set(['jacket', 'shirt', 'pants', 'shorts', 'jeans', 'hoodie', 'bag', 'backpack', 'headphones', 'glasses', 'hat', 'hair', 'shoes']);
    }

    processText(text) {
        const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
        const processed = [];
        let i = 0;
        
        while (i < words.length) {
            const current = words[i];
            const next = words[i + 1];
            
            // NTS: double check format works like this consistently
            if (next) {
                if (this.colorModifiers.has(current) && this.isColor(next)) {
                    processed.push(`${current}-${next}`);
                    i += 2;
                    continue;
                }
                
                if (this.garmentModifiers.has(current) && this.isGarment(next)) {
                    processed.push(`${current}-${next}`);
                    i += 2;
                    continue;
                }
            }
            
            processed.push(current);
            i++;
        }
    }

    decomposeCompound(word) {
        if (word.includes('-')) {
            return word.split('-');
        }
        return word;
    }
    
    isColor(word) {
        if (this.colors.has(word)) {
            return true;
        }

        for (const [canonical, synonyms] of Object.entries(this.synonymGroups)) {
            if (synonyms.includes(word)) {
                return true;
            }
        }

        return false;
    }
    
    isGarment(word) {
        const garmentCategories = ['jacket', 'shirt', 'pants', 'shorts', 'skirt'];
        if (garmentCategories.includes(word)) {
            return true;
        }

        for (const [canonical, synonyms] of Object.entries(this.synonymGroups)) {
            if (synonyms.includes(word)) {
                return true;
            }
        }

        return false;
    }

    // ai-generated function
    normalizeSynonym(word) {
        // First check if whole word is in synonym groups
        for (const [canonical, synonyms] of Object.entries(this.synonymGroups)) {
            if (synonyms.includes(word)) {
                return canonical;
            }
        }
        
        // If it's a compound (has hyphen), normalize components
        if (word.includes('-')) {
            const parts = word.split('-');
            const normalized = parts.map(part => {
                for (const [canonical, synonyms] of Object.entries(this.synonymGroups)) {
                    if (synonyms.includes(part)) {
                        return canonical;
                    }
                }
                return part;
            });
            
            // If both parts normalized to same thing (e.g., "hooded-jacket" → "jacket-jacket"), collapse
            if (normalized.length === 2 && normalized[0] === normalized[1]) {
                return normalized[0];
            }
            
            return normalized.join('-');
        }
        
        return word;
    }

    // ai-generated function
    tokenize(text) {
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, '') // Remove punctuation
            .split(/\s+/)
            .filter(w => w.length > 2 && !this.stopwords.has(w))
            .map(w => this.normalizeSynonym(w)); // ← NEW: Normalize synonyms
    }

    generateBigrams(words) {
        const bigrams = [];
        for (let i = 0; i < words.length - 1; i++) {
            bigrams.push(`${words[i]} ${words[i + 1]}`);
        }

        return bigrams;
    }

    isColorToken(token) {
        if (this.colors.has(token)) return true;
        
        // Check if it's a compound with a color component
        if (token.includes('-')) {
            const parts = token.split('-');
            return parts.some(p => this.colors.has(p));
        }
        
        return false;
    }

    scoreBigramMatch(bg1, bg2) {
        // Exact match
        if (bg1 === bg2) {
            const words = bg1.split(' ');
            
            // Color + important noun = 2 points
            if (words.some(w => this.isColorToken(w)) && words.some(w => this.importantNouns.has(w))) {
                return { score: 2, type: 'exact-color-noun', phrase: bg1 };
            }
            // Other meaningful bigrams = 1 point
            else if (words.some(w => this.importantNouns.has(w))) {
                return { score: 1, type: 'exact-clothing', phrase: bg1 };
            } else {
                return { score: 0.5, type: 'exact-generic', phrase: bg1 };
            }
        }
        
        // Partial compound match
        const words1 = bg1.split(' ');
        const words2 = bg2.split(' ');
        
        let partialScore = 0;
        const matches = [];
        
        // Check if compounds share components
        for (const w1 of words1) {
            const components1 = this.decomposeCompound(w1);
            for (const w2 of words2) {
                const components2 = this.decomposeCompound(w2);
                
                // Check component overlap
                for (const c1 of components1) {
                    if (components2.includes(c1)) {
                        if (this.isColorToken(c1)) {
                            partialScore += 1;
                            matches.push(`color:${c1}`);
                        } else if (this.importantNouns.has(c1)) {
                            partialScore += 1;
                            matches.push(`garment:${c1}`);
                        } else {
                            partialScore += 0.5;
                            matches.push(`modifier:${c1}`);
                        }
                    }
                }
            }
        }
        
        if (partialScore > 0) {
            return { score: partialScore, type: 'partial-compound', phrase: `${bg1}~${bg2}`, matches };
        }
        
        return null;
    }

    matchScore(description1, description2) {
        const words1 = this.tokenize(description1);
        const words2 = this.tokenize(description2);
        
        const bigrams1 = this.generateBigrams(words1);
        const bigrams2 = this.generateBigrams(words2);
        
        let totalScore = 0;
        const breakdown = [];
        
        // Bigram matching with partial compound support
        const matchedBigrams = new Set();
        
        for (const bg1 of bigrams1) {
            for (const bg2 of bigrams2) {
                if (matchedBigrams.has(bg2)) continue;
                
                const match = this.scoreBigramMatch(bg1, bg2);
                if (match) {
                    totalScore += match.score;
                    breakdown.push(match);
                    matchedBigrams.add(bg2);
                    break; // Only match each bigram once
                }
            }
        }
        
        // Gender match (high value: 2 points)
        if (words1.includes('male') && words2.includes('male')) {
            totalScore += 2;
            breakdown.push({ score: 2, type: 'gender', phrase: 'male' });
        } else if (words1.includes('female') && words2.includes('female')) {
            totalScore += 2;
            breakdown.push({ score: 2, type: 'gender', phrase: 'female' });
        }
        
        // Single word matches for clothing types (avoid double-counting)
        const alreadyMatchedWords = new Set(
            breakdown.flatMap(b => b.phrase.split(/[\s~]/).flatMap(w => w.split('-')))
        );
        
        const clothingWords = ['jacket', 'shirt', 'pants', 'shorts', 'bag', 'backpack', 'headphones'];
        for (const word of clothingWords) {
            if (words1.includes(word) && words2.includes(word) && !alreadyMatchedWords.has(word)) {
                totalScore += 1;
                breakdown.push({ score: 1, type: 'clothing-type', phrase: word });
            }
        }
        
        return {
            score: totalScore,
            matched: totalScore >= this.minMatchScore,
            breakdown,
            details: {
                description1,
                description2,
                words1,
                words2,
                bigrams1,
                bigrams2
            }
        };
    }

    formatBreakdown(breakdown) {
        return breakdown.map(b => {
            if (b.matches) {
                return `${b.phrase} [${b.matches.join(', ')}] (+${b.score})`;
            }
            return `${b.phrase} (+${b.score} ${b.type})`;
        }).join(', ');
    }

}