import dotenv from 'dotenv';
dotenv.config();
import fetch from 'node-fetch';

async function test() {
    try {
        const response = await fetch('https://apiv2.shiprocket.in/v1/external/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: process.env.SHIPROCKET_API_EMAIL,
                password: process.env.SHIPROCKET_API_PASSWORD
            })
        });
        const authData = await response.json();
        const token = authData.token;

        const ordersResp = await fetch('https://apiv2.shiprocket.in/v1/external/orders?page=1&per_page=1', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const ordersData = await ordersResp.json();
        if (ordersData.data && ordersData.data.length > 0) {
            const order = ordersData.data[0];
            console.log("Order Keys:", Object.keys(order));
            if (order.customer_city) console.log("customer_city:", order.customer_city);
            if (order.customer_state) console.log("customer_state:", order.customer_state);
            console.log("Customer specific fields:", Object.keys(order).filter(k => k.includes('customer')));
            console.log("City fields:", Object.keys(order).filter(k => k.includes('city')));

            // let's also look at the first shipment
            if (order.shipments && order.shipments.length > 0) {
                console.log("Shipment Keys:", Object.keys(order.shipments[0]));
            }
        }
    } catch (e) { console.error(e); }
}

test();
