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
            4. NO GREETINGS, but ALWAYS end the message with "- PhotobookX team".
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
            model: 'gpt-5.6',
            messages: [
                { role: 'system', content: 'You write extremely short, bulleted logistics complaints in plain casual English without any greetings, always ending with "- PhotobookX team", and using only dates.' },
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
        pendingOrdersCount: number,
        avgPLPerDay: number,
        avgOrdersPerDay: number,
        ndrRate: number,
        stats?: any,
        sixMonthsStats: any[],
        sixMonthsDailyData: any[]
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
            - Payment Mix: ${JSON.stringify((data as any).stats || {})}
            
            Deep Granular Historical Stats Provided (Last 6 Months, oldest Feb 2026):
            1. Monthly Breakdown (Total Orders, NDR Rate [% of COD and % of Prepaid], Total P/L): 
            ${JSON.stringify(data.sixMonthsStats)}
            
            2. Daily Breakdown (Orders Placed, Delivered, Failed): 
            ${JSON.stringify(data.sixMonthsDailyData)}
            
            Analytics Context:
            - "Realized P/L" is current profit from Delivered + Prepaid orders, MINUS Ad Spend and Shipping.
            - "Pending Orders" are COD orders not yet Delivered or Failed.
            - High COD ratio usually leads to higher final NDR.
            
            Task:
            Look at the rate of the current month in comparison to the 6-month historic data. Based on these historical trends:
            1. Predict FINAL TOTAL ORDERS for the month (Current + projected for remaining days).
            2. Predict FINAL NDR RATE (%) - adjust based on historic trends and current COD/Prepaid ratio.
            3. Predict FINAL PROFIT (₹) - account for historic margins, current performance, and expected NDR impact.
            4. Provide a "Master Insight" - a short, actionable sentence for the business owner.
            
            Return ONLY a valid JSON object with:
            {
              "predictedOrders": number,
              "predictedNDR": number,
              "predictedFinalProfit": number,
              "reasoning": "Detailed 2-3 sentence logic accounting for historical trends, payment mix and accrued profit",
              "insight": "1 short punchy actionable line"
            }
        `;

        console.log('--- AI Forecast Prompt ---');
        console.log(prompt);
        console.log('---------------------------');

        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-5.6',
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
                model: 'gpt-5.6',
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
    async generateIncompleteAddressMessage(data: {
        customerName: string;
        orderNumber: string;
    }) {
        if (!this.openai) {
            throw new Error('OpenAI API key is missing.');
        }

        const prompt = `
            Task: Draft a concise, professional WhatsApp message for an e-commerce order with an incomplete address.
            
            Context:
            - Customer Name: ${data.customerName}
            - Order Number: ${data.orderNumber}
            
            Requirements:
            1. Keep it concise but VERY warm, polite, and respectful.
            2. Greet the customer warmly by their first name (e.g. "Dear Ankit," or "Hi Ankit,") if available.
            3. Kindly request the customer to provide their complete address (including House No, Area, Landmark, and Pincode) so we can ensure their photobook reaches them safely and quickly. Use words like "please" or "kindly".
            4. Mention the order number for reference.
            5. End with a warm closing like "Thank you," followed by "- PhotobookX team".
            6. Do not use placeholders.
            7. Return only the message text.
            
            Tone: Very polite, respectful, warm, and customer-first.
        `;

        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-5.6',
                messages: [
                    { role: 'system', content: 'You are a professional customer support assistant for PhotoBookX.' },
                    { role: 'user', content: prompt }
                ]
            });

            return response.choices[0].message.content || '';
        } catch (err: any) {
            console.error('AIService Incomplete Address Message Error:', err);
            throw err;
        }
    }

    async generateMultipleOrdersMessage(data: {
        customerName: string;
        orderNumber: string;
    }) {
        if (!this.openai) {
            throw new Error('OpenAI API key is missing.');
        }

        const prompt = `
            Task: Draft a concise, professional WhatsApp message for a customer who has placed multiple identical or similar orders.
            
            Context:
            - Customer Name: ${data.customerName}
            - Main Order Number: ${data.orderNumber}
            
            Requirements:
            1. Keep it concise but VERY warm, polite, and respectful.
            2. Greet the customer warmly by their first name (e.g. "Dear Ankit," or "Hi Ankit,") if available.
            3. Politely inform them that we noticed they have placed multiple orders.
            4. Kindly ask them to confirm exactly how many quantities of the photobook they need, so we can process their order perfectly. Use words like "please" or "kindly".
            5. End with a warm closing like "Thank you," followed by "- PhotobookX team".
            6. Do not use placeholders.
            7. Return only the message text.
            
            Tone: Very polite, respectful, warm, and customer-first.
        `;

        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-5.6',
                messages: [
                    { role: 'system', content: 'You are a professional customer support assistant for PhotoBookX.' },
                    { role: 'user', content: prompt }
                ]
            });

            return response.choices[0].message.content || '';
        } catch (err: any) {
            console.error('AIService Multiple Orders Message Error:', err);
            throw err;
        }
    }
}

export default new AIService();
