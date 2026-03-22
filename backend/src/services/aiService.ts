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

    async predictMonthEnd(data: {
        monthYear: string,
        daysElapsed: number,
        totalDays: number,
        currentOrders: number,
        currentPL: number,
        historicalData: any[], // Daily breakdown of sales/expenses/orders
        pendingOrdersCount: number,
        avgPLPerDay: number,
        avgOrdersPerDay: number,
        ndrRate: number
    }) {
        console.log('--- Calling AIService.predictMonthEnd ---');
        if (!this.openai) {
            throw new Error('OpenAI API key is missing.');
        }

        const prompt = `
            Month-End Comprehensive Business Prediction Task:
            Target Month: ${data.monthYear}
            Current Progress: ${data.daysElapsed}/${data.totalDays} days elapsed.
            
            Current Performance:
            - Orders: ${data.currentOrders} (Avg: ${data.avgOrdersPerDay.toFixed(1)}/day)
            - Realized P/L: ₹${data.currentPL.toFixed(2)} (Avg: ₹${data.avgPLPerDay.toFixed(2)}/day)
            - Current NDR Rate: ${data.ndrRate.toFixed(2)}%
            - Pending Orders awaiting delivery results: ${data.pendingOrdersCount} (These are COD orders in-transit)
            
            Deep Granular Stats Provided:
            - Payment Mix: ${JSON.stringify((data as any).stats)}
            - Historical Daily Breakdown (last 90 days): 
            ${JSON.stringify(data.historicalData)}
            
            Analytics Context:
            - "Realized P/L" is current profit from Delivered + Prepaid orders, MINUS Ad Spend and Shipping.
            - "Pending Orders" are COD orders not yet Delivered or Failed.
            - Historical Daily "pl" is Combined (Accrued) - it includes realized profit + potential profit from pending orders placed that day.
            - High COD ratio usually leads to higher final NDR.
            
            Task:
            1. Predict FINAL TOTAL ORDERS for the month (Current + projected for remaining days).
            2. Predict FINAL NDR RATE (%) - adjust based on recent trend and COD/Prepaid ratio.
            3. Predict FINAL PROFIT (₹) - account for current margins and expected NDR impact on pending orders.
            4. Provide a "Master Insight" - a short, actionable sentence for the business owner.
            
            Return ONLY a valid JSON object with:
            {
              "predictedOrders": number,
              "predictedNDR": number,
              "predictedFinalProfit": number,
              "reasoning": "Detailed 2-3 sentence logic accounting for payment mix and accrued profit",
              "insight": "1 short punchy actionable line"
            }
        `;

        console.log('--- AI Forecast Prompt ---');
        console.log(prompt);
        console.log('---------------------------');

        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: 'You are a data-driven e-commerce strategist. You output precise projections in JSON.' },
                    { role: 'user', content: prompt }
                ],
                response_format: { type: 'json_object' }
            });

            const rawContent = response.choices[0].message.content || '{}';
            const result = JSON.parse(rawContent);
            return result;
        } catch (err: any) {
            console.error('AIService Error:', err);
            throw err;
        }
    }

    async predictStock(data: {
        daysToPredict: number,
        historicalData: any[], // Grouped product stats
        totalBusinessDays: number
    }) {
        if (!this.openai) {
            throw new Error('OpenAI API key is missing.');
        }

        const prompt = `
            Task: Inventory & Stock Requirement Prediction
            
            Predict exactly how much stock of each book is required for the next ${data.daysToPredict} days based on historical sales volume.
            
            Historical Context:
            - Analysis Period: Total ${data.totalBusinessDays} days of sales data provided.
            - Product Sales Data: ${JSON.stringify(data.historicalData)}
            
            Strict Requirements:
            1. For each product/variant, calculate the required stock: (Total Orders / Total Business Days) * ${data.daysToPredict} days.
            2. Factor in a "Safety Buffer" - if a product has higher volume, add a 10% safety margin.
            3. Round UP all quantities to the nearest whole integer.
            4. Provide a brief "Reasoning" for each product's stock requirement.
            
            Return ONLY a valid JSON object with:
            {
              "predictions": [
                {
                  "productName": "string",
                  "variantTitle": "string",
                  "currentAvgPerDay": number,
                  "requiredStock": number,
                  "reasoning": "1 short sentence explaining context"
                }
              ]
            }
        `;

        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: 'You are an inventory planning expert. You output precise stock requirements in JSON.' },
                    { role: 'user', content: prompt }
                ],
                response_format: { type: 'json_object' }
            });

            const rawContent = response.choices[0].message.content || '{}';
            const result = JSON.parse(rawContent);
            return result;
        } catch (err: any) {
            console.error('AIService Stock Prediction Error:', err);
            throw err;
        }
    }
}

export default new AIService();
