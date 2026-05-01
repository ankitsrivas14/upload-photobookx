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
            model: 'gpt-4o',
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
                model: 'gpt-5.4',
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
                model: 'gpt-5.4',
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
    async predictDailyPerformance(data: {
        dayName: string,
        expectedAdSpend: number,
        historicalSameDayData: any[], // Array of { date, totalAdSpend, hourlyOrders: number[], hourlyRevenue: number[] }
        todayData: { totalAdSpend: number, hourlyOrders: number[], hourlyRevenue: number[], currentHour: number }
    }) {
        if (!this.openai) {
            throw new Error('OpenAI API key is missing.');
        }

        const prompt = `
            Task: Daily Hourly Sales Prediction
            
            Predict the hourly cumulative sales (orders) for today based on expected ad spend and historical performance on the same day of the week (${data.dayName}).
            
            Context:
            - Target Day: ${data.dayName}
            - Expected Total Ad Spend for Today: ₹${data.expectedAdSpend} (Note: This is the user's PLANNED spend for the WHOLE day. Use this as the primary budget driver.)
            - Actual Real-time Performance Today (up to hour ${data.todayData.currentHour}): 
                * Hourly Orders: ${JSON.stringify(data.todayData.hourlyOrders)}
                * Hourly Revenue: ${JSON.stringify(data.todayData.hourlyRevenue)}
            - Historical Data (Previous ${data.dayName}s): ${JSON.stringify(data.historicalSameDayData)}

            Guidance:
            1. Use the Historical Data to establish the natural growth curve and order distribution for a ${data.dayName}.
            2. Scale this curve based on the "Expected Total Ad Spend" for today. 
            3. Use Today's real-time performance as a "modifier" to the curve, but NOT the only driver. If today started strong without spend, expect even higher volume once spend kicks in.
            
            Requirements:
            1. Predict the hourly cumulative sales (orders) and revenue for the WHOLE day (hours 0-23). 
            2. Match today's actual data for passed hours, but project future hours using the historical growth pattern scaled to the Expected Ad Spend.
            3. The values MUST be cumulative.
            4. Return a "Reasoning" which is a concise, BULLET-POINTED summary (max 3-4 bullets) highlighting:
               - Expected ROAS for today.
               - Growth % compared to historical same-day average.
               - Brief note on how you balanced historical trends with today's real-time data and planned spend.
               - Use plain text, NO asterisks or markdown bolding. Use numeric values clearly.
            
            Return ONLY a valid JSON object with:
            {
              "predictedHourlyCumul": [number], // Exactly 24 numbers for orders
              "predictedHourlyRevenueCumul": [number], // Exactly 24 numbers for revenue
              "reasoning": "string",
              "predictedTotalOrders": number,
              "predictedTotalRevenue": number
            }
        `;

        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-5.4',
                messages: [
                    { role: 'system', content: 'You are an e-commerce data analyst. You predict hourly sales trends in JSON.' },
                    { role: 'user', content: prompt }
                ],
                response_format: { type: 'json_object' }
            });

            const rawContent = response.choices[0].message.content || '{}';
            const result = JSON.parse(rawContent);
            return result;
        } catch (err: any) {
            console.error('AIService Daily Prediction Error:', err);
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
                model: 'gpt-5.4',
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
                model: 'gpt-5.4',
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
    async analyzeAdsData(adData: any[], historicalData: any[] = []) {
        if (!this.openai) {
            throw new Error('OpenAI API key is missing.');
        }

        const inputCount = adData.length;

        // Group history by name for easier AI consumption
        const historyMap: Record<string, any[]> = {};
        historicalData.slice(0, 1000).forEach(h => {
            if (!h || !h.name || typeof h.name !== 'string') return;
            const trimmedName = h.name.trim();
            if (!historyMap[trimmedName]) historyMap[trimmedName] = [];
            historyMap[trimmedName].push({
                date: h.date,
                spend: h.spend,
                roas: h.roas,
                purchases: h.purchases,
                reach: h.reach,
                impressions: h.impressions,
                cpc: h.cpc,
                ctr: h.ctr,
                cpa: h.cpa,
                clicks: h.clicks,
                cpm: h.cpm,
                frequency: h.frequency,
                addsToCart: h.addsToCart,
                outboundClicks: h.outboundClicks
            });
        });

        const prompt = `
            Task: Ultimate Performance Marketing Architect
            
            You are a world-class performance marketing consultant with a track record of scaling multi-million dollar e-commerce brands. 
            
            Analyze the provided performance data for ${inputCount} entities (campaigns, ad sets, or ads) and provide a surgical recommendation for EVERY SINGLE ONE.
                 OBJECTIVE:
            Use your internal expertise, pattern recognition, and deep understanding of the Meta Ads auction to maximize long-term profitability and scale.
            
            HORIZONTAL SCALING RULE:
            - Max risk per ad set is 2,000 INR.
            - If an ad set is performing exceptionally well but is already near or at the 2,000 INR daily budget cap, do NOT suggest vertical scaling (raising budget further). 
            - Instead, suggest "DUPLICATE" to create a fresh copy and scale horizontally, spreading the risk.
            
            DATA CONTEXT:
            1. Current Performance: ${inputCount} ad sets from the most recent day.
            2. Historical Performance: Historical data grouped by name to help you see trends, momentum, and fatigue.
            
            UNBIASED ANALYSIS PROTOCOL:
            - **Rule**: Act entirely objectively based on the statistics (spend, purchases, ROAS, reach, impressions, CPA).
            - **Rule**: There is NO bias. If the stats dictate that an ad set should be closed—even if it is new—you must recommend "CLOSE". If it is performing well and scaling is logical, suggest "SCALE" or "DUPLICATE". Suggest exact budgets based on logic.
            
            CRITICAL REQUIREMENTS:
            - Analyze ALL ${inputCount} entities. Do not skip any. Even if an entity has 0 spend or 0 activity, you MUST provide a recommendation for it.
            - Provide exactly ${inputCount} actionable recommendations in your JSON "recommendations" array.
            
            DECISIONS:
            - Choose from: "SCALE", "CONTINUE", "MONITOR", "CLOSE", or "DUPLICATE".
            - "SCALE": Vertical scaling if budget is < 2,000 INR.
            - "DUPLICATE": Horizontal scaling if budget is already >= 2,000 INR and performance warrants more spend.
            - "CLOSE": Use this aggressively if the metrics are poor and not improving, DO NOT hesitate to kill bad ads.
            - Use your total autonomy. Consider trends, CPA stability, purchase volume, and ad fatigue signals.
            
            CURRENT DATA:
            ${JSON.stringify(adData.map((d, index) => ({ id: `entity_${index+1}`, ...d, name: (typeof d.name === 'string' ? d.name.trim() : d.name || 'Unknown') })))}
            
            HISTORICAL CONTEXT:
            ${JSON.stringify(historyMap)}
            
            Instructions:
            1. Provide a recommendation for EVERY entity in the "CURRENT DATA" block, without exception. Treat identically named entities as separate items based on their unique 'id'.
            2. "targetSpend" (INR): If suggesting SCALE, MONITOR, CONTINUE, or DUPLICATE, suggest the next 24-hour budget allocation.
            3. "Rationale": A surgical, expert insight comparing the current performance to the historical narrative and current parameters (min 30-40 words). 
               - State clearly why you made this specific decision purely based on the stats provided. No generic fluff.
            4. USE MARKDOWN: Use bolding (**Ad Name**, **₹Amount**, etc.) and clear vertical spacing within "overallStrategy" and "rationale".
            
            Return ONLY a valid JSON object:
            {
              "recommendations": [
                {
                  "id": "string (MUST match the id provided in CURRENT DATA)",
                  "name": "string",
                  "decision": "SCALE | CONTINUE | MONITOR | CLOSE | DUPLICATE",
                  "rationale": "string",
                  "targetSpend": number | "N/A",
                  "stats": { "spend": number, "roas": number, "purchases": number, "cpa": number, "cpc": number, "ctr": number, "clicks": number, "cpm": number, "addsToCart": number }
                }
              ],
              "overallStrategy": "string"
            }
        `;

        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-5.4',
                messages: [
                    { role: 'system', content: 'You are an elite performance marketer who prioritizes historical trends over single-day fluctuations.' },
                    { role: 'user', content: prompt }
                ],
                max_completion_tokens: 128000,
                response_format: { type: 'json_object' }
            });
            const result = JSON.parse(response.choices[0].message.content || '{}');
            return result;
        } catch (err: any) {
            console.error('AIService Ads Analysis Error:', err);
            throw err;
        }
    }

    async chatWithAdsStrategist(userQuestion: string, adData: any[], historicalData: any[] = [], chatHistory: any[] = []) {
        if (!this.openai) {
            throw new Error('OpenAI API key is missing.');
        }

        const historyMap: Record<string, any[]> = {};
        historicalData.slice(0, 1000).forEach(h => {
            const trimmedName = h.name.trim();
            if (!historyMap[trimmedName]) historyMap[trimmedName] = [];
            historyMap[trimmedName].push({
                date: h.date,
                spend: h.spend,
                roas: h.roas,
                purchases: h.purchases,
                reach: h.reach,
                impressions: h.impressions,
                cpc: h.cpc,
                ctr: h.ctr,
                cpa: h.cpa,
                clicks: h.clicks,
                cpm: h.cpm,
                frequency: h.frequency,
                addsToCart: h.addsToCart,
                outboundClicks: h.outboundClicks
            });
        });

        const prompt = `
            Task: Meta Ads Strategy Consultant
            
            Context: You are talking to an e-commerce brand owner. You have full access to their Meta Ads performance data.
            
            CONSULTATION GOAL:
            Answer the user's question with surgical precision. Use the provided data to back up your strategy.
            
            RELEVANT DATA:
            ${JSON.stringify(adData.map(d => ({ ...d, name: (typeof d.name === 'string' ? d.name.trim() : d.name || 'Unknown') })))}
            
            HISTORICAL TRENDS:
            ${JSON.stringify(historyMap)}
            
            PREVIOUS CONVERSATION:
            ${JSON.stringify(chatHistory.slice(-5))}
            
            USER QUESTION:
            ${userQuestion}
            
            Instructions:
            1. Be punchy, strategic, and concise. 
            2. Refer to specific ad set names if applicable.
            3. Prioritize high-level architecture: scaling winners, cutting losers, and risk management (2k cap rule).
            4. **CRITICAL**: Use Markdown formatting for readability. Use bolding (e.g. **Ad Set Name**), bulleted lists, and clear spacing between paragraphs.
            
            Return the response in structured Markdown.
        `;

        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-5.4',
                messages: [
                    { role: 'system', content: 'You are a high-level performance marketing architect.' },
                    { role: 'user', content: prompt }
                ]
            });

            return response.choices[0].message.content || "I'm sorry, I couldn't process that strategy request.";
        } catch (err: any) {
            console.error('AIService Ad Strategy Chat Error:', err);
            throw err;
        }
    }
}

export default new AIService();
