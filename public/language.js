// preprocess text (dark green puffer jacket -> dark-green puffer-jacket)
// tokenize (dark-green, puffer-jacket)
// compound matcher (synonyms, compounds, etc)
// matchScore(desc1, desc2)

export class DescAnalyzer {
    // make singleton?
    constructor(config={}) {
        this.stopwords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in',
                                'on', 'at', 'to', 'for', 'of', 'with', 'by',
                                'from', 'up', 'about', 'into', 'through',
                                'during', 'over', 'wearing',
                                'long', 'short']); // removes the chance of two adjectives

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
    
    isColor(word) {
        pass
    }
    
    isGarment(word) {
        pass
    }

    normalizeSynonym(word) {
        for (const [canonical, synonyms] of Object.entries(this.synonymGroups)) {
            if (synonyms.includes(word)) {
                return canonical; // Return the canonical form (e.g., "light-colored" → "white")
            }
        }
        return word; // Return original if no synonym found
    }

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

    matchScore(desc1, desc2) {
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
        
        Single word matches for clothing types (1 point each, but don't double-count if already in bigram)
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
}