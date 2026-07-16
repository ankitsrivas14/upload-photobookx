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
    async analyzeAdsData(adData: any[], historicalData: any[] = [], context: any = {}) {
        if (!this.openai) {
            throw new Error('OpenAI API key is missing.');
        }

        const inputCount = adData.length;

        // Creative-funnel diagnostics: hook = stopped the scroll, hold = watched through.
        // Falling hook rate on stable CPM = creative fatigue; stable hook + rising CPM = auction pressure.
        const withVideoRates = (d: any) => {
            const out: any = { ...d };
            if (d.impressions > 0 && d.videoPlays25 > 0) {
                out.hookRatePct = Number(((d.videoPlays25 / d.impressions) * 100).toFixed(2));
            }
            if (d.videoPlays25 > 0 && d.videoPlays95 >= 0) {
                out.holdRatePct = Number(((d.videoPlays95 / d.videoPlays25) * 100).toFixed(2));
            }
            return out;
        };

        // Group history by name for easier AI consumption
        const historyMap: Record<string, any[]> = {};
        historicalData.slice(0, 1000).forEach(h => {
            if (!h || !h.name || typeof h.name !== 'string') return;
            const trimmedName = h.name.trim();
            if (!historyMap[trimmedName]) historyMap[trimmedName] = [];
            historyMap[trimmedName].push(withVideoRates({
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
                outboundClicks: h.outboundClicks,
                dailyBudget: h.dailyBudget,
                videoPlays25: h.videoPlays25,
                videoPlays95: h.videoPlays95,
                videoAvgPlayTime: h.videoAvgPlayTime
            }));
        });

        // Optional context sections (built server-side from the business's own DB)
        const businessSection = context?.business ? `
            BUSINESS ECONOMICS (from the store's own P&L database — this defines "profitable"):
            - AOV: ₹${context.business.aov} | Contribution margin/order (after COGS+shipping): ₹${context.business.contributionMargin}
            - BREAKEVEN ROAS: ${context.business.breakevenROAS} — an ad set below this loses money even when Meta shows "positive" ROAS.
            ${context.business.deliveryFailureRatePct != null ? `- DELIVERY FAILURE (RTO/NDR) RATE: ~${context.business.deliveryFailureRatePct}% of orders never complete. Meta-reported ROAS therefore OVERSTATES realized revenue by roughly that fraction — judge against breakeven with this discount in mind.` : ''}
            - Anchor every SCALE/CLOSE decision on breakeven ROAS, not on generic industry intuition.` : '';

        const calendarSection = context?.calendar ? `
            CALENDAR CONTEXT:
            - Data date: ${context.calendar.date} (${context.calendar.weekday}), store timezone IST.
            - This store sells devotional photobooks (Shiv Ji / Jyotirlinga themes). Demand swings with the Hindu devotional calendar — Mondays (Somwar) and festivals like Sawan/Shravan month or Mahashivratri lift demand; account for weekday/festival effects before attributing a spike or dip to the creative or auction.` : '';

        const previousSection = context?.previousRecommendations ? `
            YOUR PREVIOUS RECOMMENDATIONS (${context.previousRecommendations.date}):
            ${JSON.stringify(context.previousRecommendations.calls)}
            - Grade your own prior calls against today's outcomes. If a SCALE call degraded or a MONITOR recovered, say so in the rationale and correct course. Consistency without accountability is worthless.` : '';

        const snapshotSection = context?.accountSnapshot?.length ? `
            FULL ACCOUNT SNAPSHOT (all ad sets today — use for PORTFOLIO-level allocation even if this batch contains only some of them):
            ${context.accountSnapshot.join('\n            ')}` : '';

        const reelsSection = context?.reelStrategies?.length ? `
            CREATIVE STRATEGY MATRIX (reels and the strategies used in each, maintained by the team):
            ${JSON.stringify(context.reelStrategies)}
            - Where an ad set's creative matches a reel by name, correlate performance with its strategies. In "overallStrategy", include a CREATIVE DIRECTION paragraph: which strategy combinations are winning, and what the team should produce next.` : '';

        const prompt = `
            Task: Ultimate Performance Marketing Architect
            
            You are a world-class performance marketing consultant with a track record of scaling multi-million dollar e-commerce brands. 
            
            Analyze the provided performance data for ${inputCount} entities (campaigns, ad sets, or ads) and provide a surgical recommendation for EVERY SINGLE ONE.
                 OBJECTIVE:
            Use your internal expertise, pattern recognition, and deep understanding of the Meta Ads auction to maximize long-term profitability and scale.
            
            HORIZONTAL SCALING RULE:
            - Max risk per ad set is 2,000 INR.
            - Each entity's "dailyBudget" field is its ACTUAL current daily budget — base SCALE vs DUPLICATE decisions and budget-change percentages on it, not on inferred spend.
            - If an ad set is performing exceptionally well but is already near or at the 2,000 INR daily budget cap, do NOT suggest vertical scaling (raising budget further).
            - Instead, suggest "DUPLICATE" to create a fresh copy and scale horizontally, spreading the risk.
            ${businessSection}
            ${calendarSection}

            DATA CONTEXT:
            1. Current Performance: ${inputCount} ad sets from the most recent day.
            2. Historical Performance: Historical data grouped by name to help you see trends, momentum, and fatigue.
            ${snapshotSection}
            ${previousSection}
            ${reelsSection}

            UNBIASED ANALYSIS PROTOCOL:
            - **Rule**: Act entirely objectively based on the statistics (spend, purchases, ROAS, reach, impressions, CPA).
            - **Rule**: There is NO bias. If the stats dictate that an ad set should be closed—even if it is new—you must recommend "CLOSE". If it is performing well and scaling is logical, suggest "SCALE" or "DUPLICATE". Suggest exact budgets based on logic.

            STATISTICAL & META-MECHANICS GUARDRAILS:
            - **Small samples**: at 1-5 purchases/day, single-day ROAS swings are mostly noise. Judge trend on 3-7 day spend-weighted aggregates. Do NOT close a historically profitable ad set on one bad day unless spend has clearly blown past CPA tolerance; prefer MONITOR with a reduced budget as the intermediate step.
            - **Learning phase**: budget changes greater than ~25% reset Meta's learning phase and destabilize delivery. Keep SCALE/reduction steps within ±25% of the current dailyBudget unless you are closing or duplicating.
            - **Attribution lag**: the most recent day's purchases may still be under-reported by Meta's attribution window. Weight the latest day slightly less than settled days.
            - **Creative diagnostics**: "hookRatePct" (3s-equivalent views/impressions) and "holdRatePct" (95% completes/25% views) are provided where available. Falling hook rate with stable CPM = creative fatigue → recommend creative refresh/DUPLICATE with new creative, not just budget cuts. Stable hook but rising CPM = auction pressure → budget/bid problem, not a creative problem. Say which one you see.

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
            ${JSON.stringify(adData.map((d, index) => withVideoRates({ id: `entity_${index+1}`, ...d, name: (typeof d.name === 'string' ? d.name.trim() : d.name || 'Unknown') })))}

            HISTORICAL CONTEXT:
            ${JSON.stringify(historyMap)}

            Instructions:
            1. Provide a recommendation for EVERY entity in the "CURRENT DATA" block, without exception. Treat identically named entities as separate items based on their unique 'id'.
            2. "targetSpend" (INR): If suggesting SCALE, MONITOR, CONTINUE, or DUPLICATE, suggest the next 24-hour budget allocation.
            3. "Rationale": A surgical, expert insight comparing the current performance to the historical narrative and current parameters (min 30-40 words).
               - State clearly why you made this specific decision purely based on the stats provided. No generic fluff.
            4. USE MARKDOWN: Use bolding (**Ad Name**, **₹Amount**, etc.) and clear vertical spacing within "overallStrategy" and "rationale".
            5. "overallStrategy" must end with: (a) a one-line TOTAL next-24h budget across the whole account with the reallocation logic, and (b) if the creative strategy matrix was provided, a CREATIVE DIRECTION paragraph naming the strategy combinations to double down on next.
            
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
                model: 'gpt-5.6',
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

async chatWithAdsStrategist(userQuestion: string, adData: any[], historicalData: any[] = [], chatHistory: any[] = [], businessContext: any = null) {
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
            ${businessContext ? `
            BUSINESS ECONOMICS (from the store's own P&L database):
            - AOV ₹${businessContext.aov} | Contribution margin/order ₹${businessContext.contributionMargin} | BREAKEVEN ROAS ${businessContext.breakevenROAS}${businessContext.deliveryFailureRatePct != null ? ` | Delivery failure (RTO/NDR) ~${businessContext.deliveryFailureRatePct}% (Meta ROAS overstates realized revenue accordingly)` : ''}
            - Anchor profitability judgements on breakeven ROAS, not generic benchmarks.
            ` : ''}
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
                model: 'gpt-5.6',
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
