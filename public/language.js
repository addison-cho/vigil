export class DescAnalyzer {
    constructor(config = {}) {
        this.minMatchScoreNormal = config.minMatchScore || 7;
        // this.minMatchScoreLowLight = config.minMatchScoreLowLight || 5.5; // More forgiving in low-light        
        // Stopwords to remove during tokenization
        this.stopwords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'over', 'wearing', 
            'person', 'individual']);
        
        // Modifiers that should be hyphenated with their base words
        this.colorModifiers = new Set(['dark', 'light', 'bright', 'pale', 'deep', 'vivid']);
        this.garmentModifiers = new Set(['puffer', 'puffy', 'hooded', 'denim', 'leather', 'baseball', 
            'running', 'cargo', 'skinny', 'zip', 'button', 'long', 'short', 'fitted', 'loose', 'oversized',
            'long-sleeved', 'short-sleeved', 'capri', 'long-sleeve', 'short-sleeve', 'patterned']);
        
        // Build/size descriptors for low-light mode
        this.buildDescriptors = new Set(['tall', 'short', 'large', 'small', 'big', 'slim', 'thin', 
            'stocky', 'heavy', 'petite', 'medium', 'average']);
        
        // Synonym groups for normalization
        this.synonymGroups = {
            // Colors - light
            'white': ['white', 'light-colored', 'light', 'pale', 'cream', 'off-white', 'ivory', 'beige'],
            'gray': ['gray', 'grey', 'charcoal', 'silver'],
            // Colors - dark
            'black': ['black'],
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
            
            // Garment shapes (for low-light mode)
            'puffy': ['puffer', 'puffy', 'padded', 'quilted'],
            'fitted': ['fitted', 'tight', 'slim'],
            'loose': ['loose', 'baggy', 'oversized'],
            'long': ['long', 'full-length', 'maxi'],
        };
        
        // Important semantic categories for weighted matching
        this.colors = new Set(['white', 'black', 'gray', 'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'brown']);
        this.importantNouns = new Set(['jacket', 'shirt', 'pants', 'shorts', 'jeans', 'hoodie', 'bag', 'backpack', 'headphones', 'glasses', 'hat', 'hair', 'shoes']);
        this.accessories = new Set(['bag', 'backpack', 'headphones', 'glasses', 'hat', 'cap', 'beanie']);
        
        // Color families for fuzzy matching (normal mode)
        this.colorFamilies = {
            'dark': ['black', 'dark', 'charcoal', 'navy', 'dark-blue', 'dark-green', 'dark-brown', 'dark-purple', 'dark-gray', 'dark-red', 'unclear', 'unknown'],
            'light': ['white', 'light', 'pale', 'cream', 'beige', 'light-blue', 'light-green', 'light-gray', 'silver', 'ivory'],
            'warm': ['red', 'orange', 'yellow', 'pink', 'burgundy', 'maroon'],
            'cool': ['blue', 'green', 'purple', 'teal', 'turquoise'],
            'neutral': ['gray', 'grey', 'brown', 'tan', 'khaki', 'beige']
        };
    }
    
    /**
     * Preprocess text to create compound tokens
     */
    preprocessText(text) {
        const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
        const processed = [];
        let i = 0;
        
        while (i < words.length) {
            const current = words[i];
            const next = words[i + 1];
            
            if (next) {
                // Color modifier + color: "dark green" → "dark-green"
                if (this.colorModifiers.has(current) && this.isColor(next)) {
                    processed.push(`${current}-${next}`);
                    i += 2;
                    continue;
                }
                
                // Color modifier + garment: "dark jacket" → keep separate but mark as color
                if (this.colorModifiers.has(current) && this.isGarment(next)) {
                    processed.push(current);
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
            
            processed.push(current);
            i++;
        }
        
        return processed.join(' ');
    }
    
    isColor(word) {
        if (this.colors.has(word)) return true;
        for (const [canonical, synonyms] of Object.entries(this.synonymGroups)) {
            if (this.colors.has(canonical) && synonyms.includes(word)) return true;
        }
        return false;
    }
    
    isGarment(word) {
        const garmentCategories = ['jacket', 'shirt', 'pants', 'shorts', 'skirt'];
        for (const category of garmentCategories) {
            if (this.synonymGroups[category] && this.synonymGroups[category].includes(word)) {
                return true;
            }
        }
        return false;
    }
    
    tokenize(text) {
        const preprocessed = this.preprocessText(text);
        return preprocessed
            .split(/\s+/)
            .filter(w => w.length > 2 && !this.stopwords.has(w))
            .map(w => this.normalizeSynonym(w));
    }
    
    normalizeSynonym(word) {
        for (const [canonical, synonyms] of Object.entries(this.synonymGroups)) {
            if (synonyms.includes(word)) return canonical;
        }
        
        if (word.includes('-')) {
            const parts = word.split('-');
            const normalized = parts.map(part => {
                for (const [canonical, synonyms] of Object.entries(this.synonymGroups)) {
                    if (synonyms.includes(part)) return canonical;
                }
                return part;
            });
            
            if (normalized.length === 2 && normalized[0] === normalized[1]) {
                return normalized[0];
            }
            return normalized.join('-');
        }
        
        return word;
    }
    
    generateBigrams(words) {
        const bigrams = [];
        for (let i = 0; i < words.length - 1; i++) {
            bigrams.push(`${words[i]} ${words[i + 1]}`);
        }
        return bigrams;
    }
    
    decomposeCompound(word) {
        return word.includes('-') ? word.split('-') : [word];
    }
    
    matchScoreNormalMode(words1, words2, bigrams1, bigrams2) {
        let totalScore = 0;
        const breakdown = [];
        const matchedBigrams = new Set();
        
        // Bigram matching with color families
        for (const bg1 of bigrams1) {
            for (const bg2 of bigrams2) {
                if (matchedBigrams.has(bg2)) continue;
                
                const match = this.scoreBigramNormal(bg1, bg2);
                if (match) {
                    totalScore += match.score;
                    breakdown.push(match);
                    matchedBigrams.add(bg2);
                    break;
                }
            }
        }
        
        // Gender match with mismatch penalty
        const hasGender1 = words1.includes('male') || words1.includes('female');
        const hasGender2 = words2.includes('male') || words2.includes('female');
        
        if (words1.includes('male') && words2.includes('male')) {
            totalScore += 2;
            breakdown.push({ score: 2, type: 'gender', phrase: 'male' });
        } else if (words1.includes('female') && words2.includes('female')) {
            totalScore += 2;
            breakdown.push({ score: 2, type: 'gender', phrase: 'female' });
        } else if (hasGender1 && hasGender2) {
            // Different genders = strong signal they're different people
            totalScore -= 3;
            breakdown.push({ score: -2, type: 'gender-mismatch', phrase: 'different genders' });
        }

        // if (words1.includes('child') && words2.includes('child')) {
        //     totalScore += 2;
        //     breakdown.push({ score: 2, type: 'age-group', phrase: 'child' });
        // }
        
        // Person match
        if (words1.includes('person') && words2.includes('person')) {
            totalScore += 1.5;
            breakdown.push({ score: 1.5, type: 'ungendered', phrase: 'person' });
        }
        
        // Single clothing word matches
        const alreadyMatched = new Set(
            breakdown.flatMap(b => b.phrase.split(/[\s~]/).flatMap(w => w.split('-')))
        );
        
        const clothingWords = ['jacket', 'shirt', 'pants', 'shorts', 'bag', 'backpack', 'headphones'];
        for (const word of clothingWords) {
            if (words1.includes(word) && words2.includes(word) && !alreadyMatched.has(word)) {
                totalScore += 1;
                breakdown.push({ score: 1, type: 'clothing-type', phrase: word });
            }
        }
        
        return { totalScore, breakdown };
    }

    scoreBigramNormal(bg1, bg2) {
        if (bg1 === bg2) {
            const words = bg1.split(' ');
            if (words.some(w => this.isColorToken(w)) && words.some(w => this.importantNouns.has(w))) {
                return { score: 3, type: 'exact-color-noun', phrase: bg1 };
            } else if (words.some(w => this.importantNouns.has(w))) {
                return { score: 1.5, type: 'exact-clothing', phrase: bg1 };
            } else {
                return { score: 0.5, type: 'exact-generic', phrase: bg1 };
            }
        }
        
        const words1 = bg1.split(' ');
        const words2 = bg2.split(' ');
        
        // Color + garment fuzzy matching
        const colorWord1 = words1.find(w => this.isColorToken(w));
        const colorWord2 = words2.find(w => this.isColorToken(w));
        const garmentWord1 = words1.find(w => this.importantNouns.has(w));
        const garmentWord2 = words2.find(w => this.importantNouns.has(w));
        
        if (colorWord1 && colorWord2 && garmentWord1 && garmentWord2) {
            const norm1 = this.normalizeGarment(garmentWord1);
            const norm2 = this.normalizeGarment(garmentWord2);
            
            // REAL QUICK
                const words1 = bg1.split(' ');
                const words2 = bg2.split(' ');
                
                const colorFirst1 = words1.indexOf(colorWord1) < words1.indexOf(garmentWord1);
                const colorFirst2 = words2.indexOf(colorWord2) < words2.indexOf(garmentWord2);
                
                if (!colorFirst1 || !colorFirst2) {
                    return null; // Invalid bigram structure
                }
                
            if (norm1 === norm2) {
                const colorMatch = this.areColorsSimilar(colorWord1, colorWord2);
                if (colorMatch) {
                    let score = 1;
                    let matchType = '';
                    
                    if (colorMatch.match === 'exact') {
                        score += 2;
                        matchType = 'exact-color-garment';
                    } else if (colorMatch.match === 'family') {
                        score += 1.5;
                        matchType = `color-family-garment (${colorMatch.families.join(',')})`;
                    } else if (colorMatch.match === 'component') {
                        score += 1;
                        matchType = `color-component-garment (${colorMatch.component})`;
                    }
                    
                    return { score, type: matchType, phrase: `${bg1}~${bg2}` };
                }
            }
        }
        
        // Partial compound matching
        let partialScore = 0;
        const matches = [];
        
        for (const w1 of words1) {
            const components1 = this.decomposeCompound(w1);
            for (const w2 of words2) {
                const components2 = this.decomposeCompound(w2);
                
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
    
    getColorFamily(colorToken) {
        const families = [];
        for (const [family, colors] of Object.entries(this.colorFamilies)) {
            if (colors.includes(colorToken)) {
                families.push(family);
            }
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
    
    areColorsSimilar(color1, color2) {
        if (color1 === color2) return { match: 'exact', score: 2 };
        
        const families1 = this.getColorFamily(color1);
        const families2 = this.getColorFamily(color2);
        const sharedFamilies = families1.filter(f => families2.includes(f));
        
        if (sharedFamilies.length > 0) {
            return { match: 'family', score: 1.5, families: sharedFamilies };
        }
        
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
    
    normalizeGarment(word) {
        const normalized = this.normalizeSynonym(word);
        if (normalized.includes('-')) {
            const parts = normalized.split('-');
            for (const part of parts) {
                if (this.importantNouns.has(part)) return part;
            }
            return parts[parts.length - 1];
        }
        return normalized;
    }
    
    isColorToken(token) {
        if (this.colors.has(token)) return true;
        const normalized = this.normalizeSynonym(token);
        if (this.colors.has(normalized)) return true;
        if (token.includes('-')) {
            const parts = token.split('-');
            return parts.some(p => this.colors.has(p) || this.colors.has(this.normalizeSynonym(p)));
        }
        return false;
    }
    
    /**
     * Main matching - switches strategy based on mode
     */
    matchScore(description1, description2) {
        const words1 = this.tokenize(description1);
        const words2 = this.tokenize(description2);
        const bigrams1 = this.generateBigrams(words1);
        const bigrams2 = this.generateBigrams(words2);
        
        let result;
        let threshold;
        
        result = this.matchScoreNormalMode(words1, words2, bigrams1, bigrams2);
        threshold = this.minMatchScoreNormal;

        return {
            score: result.totalScore,
            matched: result.totalScore >= threshold,
            threshold: threshold,
            breakdown: result.breakdown,
            details: { description1, description2, words1, words2, bigrams1, bigrams2 }
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