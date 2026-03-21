import OpenAI from 'openai';
import config from '../config';

class AIService {
    private openai: OpenAI | null = null;

    constructor() {
        const apiKey = process.env.OPENAI_API_KEY;
        if (apiKey) {
            this.openai = new OpenAI({ apiKey });
        }
    }

    async generateSupportMessage(activities: any[], orderName: string, courierName: string, customerName: string, awb?: string, currentStatus?: string) {
        if (!this.openai) {
            throw new Error('OpenAI API key is missing. Please add OPENAI_API_KEY to your .env file.');
        }

        const latestActivity = activities.length > 0 ? activities[0] : null;
        const pickedUpActivity = [...activities].reverse().find(a => a.activity.toLowerCase().includes('picked'));
        
        // Calculate days ago for pickup
        let pickedUpDaysAgo = '';
        if (pickedUpActivity && pickedUpActivity.date) {
            const pickupDate = new Date(pickedUpActivity.date);
            const now = new Date();
            const diffTime = Math.abs(now.getTime() - pickupDate.getTime());
            pickedUpDaysAgo = `${Math.floor(diffTime / (1000 * 60 * 60 * 24))} days ago`;
        }

        const prompt = `
            Order: ${orderName}
            Target Courier: ${courierName}
            Customer: ${customerName}
            Current Status: ${currentStatus || 'Unknown'}
            Latest Activity: ${latestActivity ? `${latestActivity.activity} (${latestActivity.date.split(' ')[0]})` : 'Unknown'}
            
            Strict Rules:
            1. ONLY DATES (YYYY-MM-DD), remove any time (HH:MM:SS) from everywhere.
            2. For "Picked up", use format: Picked up: Date (X days ago).
            3. ENGLISH ONLY. No Hindi words like "yaar" or "bhai".
            4. NO GREETINGS AND NO CLOSING.
            5. FORMAT: 
               - Start with a very short, casual 1-sentence description of the problem (e.g., this order is stuck).
               - Then provide these 4 details in a BULLET POINT list:
                 * AWB: ${awb || 'N/A'}
                 * Customer: ${customerName}
                 * Picked up: ${pickedUpActivity ? pickedUpActivity.date.split(' ')[0] : 'N/A'} (${pickedUpDaysAgo})
                 * Last Status: ${currentStatus || (latestActivity ? latestActivity.activity : 'Unknown')} (${latestActivity ? latestActivity.date.split(' ')[0] : 'N/A'})
               - End with another short, casual 1-sentence line asking for resolution.
            
            Tone: Very casual and direct, easy English.
            Generate only the message.
        `;

        const response = await this.openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'You write extremely short, bulleted logistics complaints in plain casual English without any greetings or closing, using only dates.' },
                { role: 'user', content: prompt }
            ]
        });

        return response.choices[0].message.content;
    }
}

export default new AIService();
