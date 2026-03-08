import mongoose from 'mongoose';
import config from '../src/config';
import ShippingCharge from '../src/models/ShippingCharge';
import shiprocketService from '../src/services/shiprocketService';

async function migrate() {
    try {
        await mongoose.connect(config.mongoUri);

        console.log("Fetching all orders from Shiprocket to migrate pincodes...");
        const map = await shiprocketService.getAllRecentOrdersMap(2000);

        console.log(`Fetched ${map.size} orders from Shiprocket. Updating DB...`);
        let updated = 0;
        let inserted = 0;

        // Fetch all existing ShippingCharges
        const existingCharges = await ShippingCharge.find({}, { orderNumber: 1 });
        const existingSet = new Set(existingCharges.map(sc => sc.orderNumber.replace(/^#/, '')));

        for (const [key, shiprocketOrder] of map.entries()) {
            if (shiprocketOrder.customer_pincode) {
                // Remove # prefix for consistency check
                const normalized = key.replace(/^#/, '');

                if (existingSet.has(normalized)) {
                    const result = await ShippingCharge.updateMany(
                        { orderNumber: { $in: [normalized, `#${normalized}`] } },
                        {
                            $set: {
                                customerPincode: shiprocketOrder.customer_pincode,
                                customerCity: shiprocketOrder.customer_city,
                                customerState: shiprocketOrder.customer_state
                            }
                        }
                    );

                    if (result.modifiedCount > 0) {
                        updated += result.modifiedCount;
                    }
                } else {
                    // It does not exist in ShippingCharge but it's in Shiprocket.
                    // We can insert a record for it so that we at least have the pincode.
                    const newCharge = new ShippingCharge({
                        orderNumber: normalized,
                        shippingCharge: 0,
                        freightForward: 0,
                        freightCOD: 0,
                        freightRTO: 0,
                        shiprocketOrderId: shiprocketOrder.id,
                        customerPincode: shiprocketOrder.customer_pincode,
                        customerCity: shiprocketOrder.customer_city,
                        customerState: shiprocketOrder.customer_state,
                        customerName: shiprocketOrder.customer_name,
                        pickupDate: shiprocketOrder.picked_up_date,
                        status: 'Unknown',
                        fetchedAt: new Date(),
                    });

                    if (shiprocketOrder.shipments && shiprocketOrder.shipments.length > 0) {
                        newCharge.awbCode = shiprocketOrder.shipments[0].awb_code || shiprocketOrder.shipments[0].awb;
                        newCharge.courierName = shiprocketOrder.shipments[0].courier_name || shiprocketOrder.shipments[0].courier;
                        newCharge.status = shiprocketOrder.shipments[0].status;
                    }

                    await newCharge.save();
                    inserted++;
                    existingSet.add(normalized); // avoid duplicates
                }
            }
        }

        console.log(`Successfully migrated/updated ${updated} existing records and inserted ${inserted} new ShippingCharge records with customerPincode`);
    } catch (e) {
        console.error("Migration Error:", e);
    } finally {
        process.exit(0);
    }
}

migrate();
