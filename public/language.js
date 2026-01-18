export class DescAnalyzer {
    constructor(config = {}) {
        this.minMatchScore = config.minMatchScore || 5;
        
        // Stopwords to remove during tokenization
        this.stopwords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'over', 'wearing', 
            'person', 'individual']);
        
        // Modifiers that should be hyphenated with their base words
        this.colorModifiers = new Set(['dark', 'light', 'bright', 'pale', 'deep', 'vivid']);
        this.garmentModifiers = new Set(['puffer', 'hooded', 'denim', 'leather', 'baseball', 
            'running', 'cargo', 'skinny', 'zip', 'button', 'long', 'short']);
        
        // Synonym groups for normalization
        this.synonymGroups = {
            // Colors - light
            'white': ['white', 'light-colored', 'light', 'pale', 'cream', 'off-white', 'ivory', 'beige'],
            'gray': ['gray', 'grey', 'charcoal', 'silver'],
            // Colors - dark
            'black': ['black', 'dark-colored', 'dark'], // Added standalone "dark"
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
        
        // Important semantic categories for weighted matching
        this.colors = new Set(['white', 'black', 'gray', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown']);
        this.importantNouns = new Set(['jacket', 'shirt', 'pants', 'shorts', 'jeans', 'hoodie', 'bag', 'backpack', 'headphones', 'glasses', 'hat', 'hair', 'shoes']);
        
        // Color families for fuzzy matching
        this.colorFamilies = {
            'dark': ['black', 'dark', 'charcoal', 'navy', 'dark-blue', 'dark-green', 'dark-brown', 'dark-purple', 'dark-gray', 'dark-red'],
            'light': ['white', 'light', 'pale', 'cream', 'beige', 'light-blue', 'light-green', 'light-gray', 'silver', 'ivory'],
            'warm': ['red', 'orange', 'yellow', 'pink', 'burgundy', 'maroon'],
            'cool': ['blue', 'green', 'purple', 'teal', 'turquoise'],
            'neutral': ['gray', 'grey', 'brown', 'tan', 'khaki', 'beige']
        };
    }
    
    /**
     * Preprocess text to create compound tokens
     * "dark green puffer jacket" → "dark-green puffer-jacket"
     */
    preprocessText(text) {
        const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
        const processed = [];
        let i = 0;
        
        while (i < words.length) {
            const current = words[i];
            const next = words[i + 1];
            
            // Check if current word is a modifier that should be compounded
            if (next) {
                // Color modifier + color: "dark green" → "dark-green"
                if (this.colorModifiers.has(current) && this.isColor(next)) {
                    processed.push(`${current}-${next}`);
                    i += 2;
                    continue;
                }
                
                // Color modifier + garment: "dark jacket" → treat as "dark-colored jacket"
                // This handles AI saying "dark jacket" instead of "dark blue jacket"
                if (this.colorModifiers.has(current) && this.isGarment(next)) {
                    // Don't compound, but mark "dark" as a color token
                    processed.push(current); // "dark" will be treated as a dark-family color
                    processed.push(next);
                    i += 2;
                    continue;
                }
                
                // Garment modifier + garment: "puffer jacket" → "puffer-jacket"
                if (this.garmentModifiers.has(current) && this.isGarment(next)) {
                    processed.push(`${current}-${next}`);
                    i += 2;
                    continue;
                }
            }
            
            // No compound formed, add word as-is
            processed.push(current);
            i++;
        }
        
        return processed.join(' ');
    }
    
    /**
     * Check if a word (or its synonym) is a color
     */
    isColor(word) {
        if (this.colors.has(word)) return true;
        
        // Check if it's a synonym of a color
        for (const [canonical, synonyms] of Object.entries(this.synonymGroups)) {
            if (this.colors.has(canonical) && synonyms.includes(word)) {
                return true;
            }
        }
        return false;
    }
    
    /**
     * Check if a word (or its synonym) is a garment
     */
    isGarment(word) {
        const garmentCategories = ['jacket', 'shirt', 'pants', 'shorts', 'skirt'];
        
        for (const category of garmentCategories) {
            if (this.synonymGroups[category] && this.synonymGroups[category].includes(word)) {
                return true;
            }
        }
        return false;
    }
    
    /**
     * Tokenize text: remove stopwords, filter short words, normalize synonyms
     */
    tokenize(text) {
        // First preprocess to create compounds
        const preprocessed = this.preprocessText(text);
        
        return preprocessed
            .split(/\s+/)
            .filter(w => w.length > 2 && !this.stopwords.has(w))
            .map(w => this.normalizeSynonym(w));
    }
    
    /**
     * Normalize a word to its canonical synonym form
     * Handles both simple words and compound words
     */
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
    
    /**
     * Generate bigrams from word array
     */
    generateBigrams(words) {
        const bigrams = [];
        for (let i = 0; i < words.length - 1; i++) {
            bigrams.push(`${words[i]} ${words[i + 1]}`);
        }
        return bigrams;
    }
    
    /**
     * Decompose a compound word into its components
     * "dark-green" → ["dark", "green"]
     */
    decomposeCompound(word) {
        if (word.includes('-')) {
            return word.split('-');
        }
        return [word];
    }
    
    /**
     * Calculate match score between two bigrams, including partial compound matches
     */
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
        
        const words1 = bg1.split(' ');
        const words2 = bg2.split(' ');
        
        // FUZZY COLOR MATCHING
        // Check if this is a "color + garment" bigram in both
        const colorWord1 = words1.find(w => this.isColorToken(w));
        const colorWord2 = words2.find(w => this.isColorToken(w));
        const garmentWord1 = words1.find(w => this.importantNouns.has(w));
        const garmentWord2 = words2.find(w => this.importantNouns.has(w));
        
        if (colorWord1 && colorWord2 && garmentWord1 && garmentWord2) {
            // Normalize garments (handles compounds like "puffer-jacket" → "jacket")
            const normalizedGarment1 = this.normalizeGarment(garmentWord1);
            const normalizedGarment2 = this.normalizeGarment(garmentWord2);
            
            if (normalizedGarment1 === normalizedGarment2) {
                // Check color similarity
                const colorMatch = this.areColorsSimilar(colorWord1, colorWord2);
                
                if (colorMatch) {
                    let score = 1; // Base garment match
                    let matchType = '';
                    
                    if (colorMatch.match === 'exact') {
                        score += 2; // Exact color + garment = 3 pts total
                        matchType = 'exact-color-garment';
                    } else if (colorMatch.match === 'family') {
                        score += 1.5; // Color family + garment = 2.5 pts total
                        matchType = `color-family-garment (${colorMatch.families.join(',')})`;
                    } else if (colorMatch.match === 'component') {
                        score += 1; // Color component + garment = 2 pts total
                        matchType = `color-component-garment (${colorMatch.component})`;
                    }
                    
                    return { 
                        score,
                        type: matchType, 
                        phrase: `${bg1}~${bg2}` 
                    };
                }
            }
        }
        
        // Partial compound match (original logic)
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
    
    /**
     * Normalize a garment word, handling compounds
     * "puffer-jacket" → "jacket", "hooded-jacket" → "jacket"
     */
    normalizeGarment(word) {
        // First try direct synonym lookup
        const normalized = this.normalizeSynonym(word);
        
        // If it's a compound that didn't fully normalize, extract the base garment
        if (normalized.includes('-')) {
            const parts = normalized.split('-');
            // Return the part that's a known garment type
            for (const part of parts) {
                if (this.importantNouns.has(part)) {
                    return part;
                }
            }
            // If no known garment, return last part (usually the base noun)
            return parts[parts.length - 1];
        }
        
        return normalized;
    }
    
    /**
     * Check if a token is a color (accounting for compounds like "dark-green")
     */
    isColorToken(token) {
        // Check base colors
        if (this.colors.has(token)) return true;
        
        // Check if it normalizes to a color via synonyms
        const normalized = this.normalizeSynonym(token);
        if (this.colors.has(normalized)) return true;
        
        // Check if it's a compound with a color component
        if (token.includes('-')) {
            const parts = token.split('-');
            return parts.some(p => this.colors.has(p) || this.colors.has(this.normalizeSynonym(p)));
        }
        
        return false;
    }
    
    /**
     * Get color family for a color token
     * "dark-blue" → "dark", "red" → "warm", etc.
     */
    getColorFamily(colorToken) {
        const families = [];
        
        for (const [family, colors] of Object.entries(this.colorFamilies)) {
            if (colors.includes(colorToken)) {
                families.push(family);
            }
            
            // Also check if compound color contains family members
            if (colorToken.includes('-')) {
                const parts = colorToken.split('-');
                for (const part of parts) {
                    if (colors.includes(part)) {
                        families.push(family);
                    }
                }
            }
        }
        
        return families;
    }
    
    /**
     * Check if two colors are in the same family
     * "dark-blue" and "black" → both in 'dark' family
     */
    areColorsSimilar(color1, color2) {
        // Exact match
        if (color1 === color2) return { match: 'exact', score: 2 };
        
        // Check if they share a color family
        const families1 = this.getColorFamily(color1);
        const families2 = this.getColorFamily(color2);
        
        const sharedFamilies = families1.filter(f => families2.includes(f));
        
        if (sharedFamilies.length > 0) {
            return { match: 'family', score: 1.5, families: sharedFamilies };
        }
        
        // Check if compound colors share any component
        if (color1.includes('-') || color2.includes('-')) {
            const parts1 = color1.split('-');
            const parts2 = color2.split('-');
            
            for (const p1 of parts1) {
                for (const p2 of parts2) {
                    if (p1 === p2) {
                        return { match: 'component', score: 1, component: p1 };
                    }
                }
            }
        }
        
        return null;
    }
    
    /**
     * Main matching function - returns detailed score and breakdown
     */
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
    
    /**
     * Format match breakdown for readable logging
     */
    formatBreakdown(breakdown) {
        return breakdown.map(b => {
            if (b.matches) {
                return `${b.phrase} [${b.matches.join(', ')}] (+${b.score})`;
            }
            return `${b.phrase} (+${b.score} ${b.type})`;
        }).join(', ');
    }
}