export class Interpreter {

    // continue refining later
    constructor() {
        this.stopwords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'from', 'up', 'about', 'into', 'through', 'during', 'over', 'wearing', 
            'person', 'individual']);
        
        // figure out how to deal with color modifiers later
        this.colorModifiers = new Set(['dark', 'light', 'bright', 'pale', 'deep', 'vivid']);
        this.garmentModifiers = new Set(['puffer', 'puffy', 'hooded', 'denim', 'leather', 'baseball', 
            'running', 'cargo', 'skinny', 'zip', 'button', 'long', 'short', 'fitted', 'loose', 'oversized',
            'long-sleeved', 'short-sleeved', 'capri', 'long-sleeve', 'short-sleeve', 'patterned']);
        
        // Build/size descriptors for low-light mode
        // this.buildDescriptors = new Set(['tall', 'short', 'large', 'small', 'big', 'slim', 'thin', 'stocky', 'heavy', 'petite', 'medium', 'average']);
        
        // synonym groups for normalization
        this.colorGroups = {};
        this.garmentModifierGroups = {};
        this.nounGroups = {};
        this.typeGroups = {};
        // need to implement accessories later
        // this.accessories = new Set(['bag', 'backpack', 'headphones', 'glasses', 'hat', 'cap', 'beanie']);
    }

    stripText(text) {
        return text
            .toLowerCase()
            .filter(w => w.length > 2 && !this.stopwords.has(w))
    }

    processText(text) {
        text = stripText(text);

        // temp: fix later
        colors = this.colors;
        modifiers = this.modifiers;
        nouns = this.nouns;
        genderWords = this.genderWords;

        const words = text.split(/\s+/).filter(w => w.length > 0);
        const chunks = [];
        let currentDescriptors = [];
        let gender = null;

        for (let i = 0; i < words.length; i++) {
            const word = words[i];

            // Check if it's a gender word (usually first)
            if (genderWords.has(word) && !gender) {
                gender = word;
                continue;
            }

            // Check if it's a known adjective/color/modifier
            if (colors.has(word) || modifiers.has(word)) {
                currentDescriptors.push(word);
                continue;
            }

            // Check if it's a known noun
            if (nouns.has(word)) {
                const category = nouns.get(word);
                chunks.push({
                    type: category,
                    descriptors: [...currentDescriptors, word]
                });
                currentDescriptors = [];
                continue;
            }

            // Unknown word - treat as noun (conservative approach)
            // Create chunk and reset
            if (currentDescriptors.length > 0) {
                chunks.push({
                    type: 'unknown',
                    descriptors: [...currentDescriptors, word]
                });
            } else {
                // Unknown standalone word (like "backpack" we don't recognize)
                chunks.push({
                    type: 'unknown',
                    descriptors: [word]
                });
            }
            currentDescriptors = [];
        }

        // Handle any remaining descriptors (edge case: description ends with adjectives)
        if (currentDescriptors.length > 0) {
            chunks.push({
                type: 'unknown',
                descriptors: currentDescriptors
            });
        }

        return {
            gender,
            chunks
        };
    }

    // choose later: person, desc, or other? probably desc, since person 
    // needs to be not a silhouette first
    matchScore(desc1, desc2) {}

    matchScoreNight(desc1, desc2) {}
}