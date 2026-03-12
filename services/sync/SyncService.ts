import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import {
    createShopPlan as apiCreateShopPlan,
    shopPlanList as apiShopPlanList,
    updateShopPlan as apiUpdateShopPlan,
    insertItems,
    itemsByPlan,
    startShopPlan,
} from "../api/apiClient";
import { dbPromise } from "../database/database";

type PendingOperation = {
    id: number;
    entity_type: string;
    entity_id: string;
    operation_type: "insert" | "update" | "delete" | "start";
    payload: string | null;
    attempts: number;
};

let isSyncing = false;

export async function runSync() {
    if (isSyncing) return;

    const net = await NetInfo.fetch();
    if (!net.isConnected) {
        return;
    }

    isSyncing = true;

    try {
        const db = await dbPromise;

        const ops: PendingOperation[] = await db.getAllAsync(
            `SELECT * FROM pending_operations ORDER BY created_at ASC`,
        );

        // console.log("ops", ops);

        for (const op of ops) {
            try {
                const payload = op.payload ? JSON.parse(op.payload) : null;

                // console.log("payload", payload);
                if (op.entity_type === "shop_plans") {
                    if (op.operation_type === "insert") {
                        const response = await apiCreateShopPlan(payload);
                        await db.runAsync(
                            `UPDATE shop_plans SET server_id = ? WHERE id = ?`,
                            [response.data.id, Number(op.entity_id)],
                        );

                        // await db.runAsync(
                        //     `UPDATE pending_operations SET entity_id = ? WHERE shop_plan_id = ?`,
                        //     [response.data?.id, Number(op.entity_id)],
                        // );
                    } else if (op.operation_type === "start") {
                        let sid: number = payload.server_id;

                        if (!payload.server_id) {
                            const getRes = await db.getFirstAsync<{
                                server_id: number;
                            }>(
                                `SELECT server_id FROM shop_plans WHERE id = ?`,
                                Number(op.entity_id),
                            );
                            if (getRes) {
                                sid = getRes.server_id;
                            }
                        }

                        const res = await startShopPlan(
                            Number(sid),
                            payload.updated_at,
                        );
                        if (typeof res.data == "object") {
                            const data = res.data;
                            await db.runAsync(
                                `UPDATE shop_plans SET status = ?, budget = ?, updated_at = CURRENT_TIMESTAMP WHERE server_id = ?`,
                                [data.status, data.budget, data.updated_at],
                            );
                        }
                    } else if (op.operation_type === "update") {
                        const res = await apiUpdateShopPlan(
                            payload,
                            Number(op.entity_id),
                        );

                        if (res.data?.shop_plans) {
                            const shop_plans = res.data.shop_plans;
                            const items = res.data.items;

                            await db.runAsync(
                                `UPDATE shop_plans SET status = ?, budget = ?, updated_at = CURRENT_TIMESTAMP WHERE server_id = ?`,
                                [
                                    shop_plans.status,
                                    shop_plans.budget,
                                    shop_plans.updated_at,
                                ],
                            );

                            const shopplan = await db.getFirstAsync<{
                                id: number;
                            }>(
                                `SELECT id FROM shop_plans WHERE server_id = ? LIMIT 1`,
                                Number(op.entity_id),
                            );

                            if (shopplan) {
                                await db.runAsync(
                                    `DELETE FROM items WHERE shop_plan_id = ?`,
                                    shopplan.id,
                                );

                                for (const item of items) {
                                    await db.runAsync(
                                        `INSERT INTO items (server_id, shop_plan_id, name, price, expected_quantity, actual_quantity) VALUES(?,?,?,?,?,?)`,
                                        [
                                            item.id,
                                            shopplan.id,
                                            item.name,
                                            item.price,
                                            item.expected_quantity,
                                            item.actual_quantity,
                                        ],
                                    );
                                }
                            }
                        }
                    } else if (op.operation_type === "delete") {
                    }
                } else if (op.entity_type === "items") {
                    if (op.operation_type === "insert") {
                        payload.forEach(async (item: any) => {
                            await insertItems(item);
                            // console.log("item", item);
                            // for (const [key, value] of Object.entries(item)) {
                            //     console.log("type", typeof value);
                            //     console.log(`${key}: ${value}`);
                            // }
                        });
                    }
                }

                await db.runAsync(
                    `DELETE FROM pending_operations WHERE id = ?`,
                    op.id,
                );
            } catch (err: any) {
                const message =
                    err?.response?.data?.message ||
                    err?.message ||
                    "Unknown error";

                await db.runAsync(
                    `UPDATE pending_operations
                    SET attempts = attempts + 1,
                        last_error = ?
                    WHERE id = ?`,
                    message,
                    op.id,
                );

                console.log("errors: ", err?.response?.data);

                if (!err.response || err.response.status >= 500) {
                    break;
                }
            }
        }

        const userString = await AsyncStorage.getItem("auth-user");
        // console.log("auth user in runSync: ", userString);
        if (userString) {
            const user = JSON.parse(userString);
            const res = await apiShopPlanList(user.id); // retrieve shopplans from starting from 3 days ago

            // console.log("res", res);
            if (res) {
                // loop each plans and check wether to insert or update sqlite
                for (const plan of res.data) {
                    const local = await db.getFirstAsync<any>(
                        `SELECT * FROM shop_plans WHERE server_id = ?`,
                        plan.id,
                    );

                    const items = await itemsByPlan(plan.id);

                    // console.log("plan from sync", plan);
                    // console.log("items from sync", items);
                    // console.log("local plan", local);
                    // console.log("planID", plan.id);

                    // insert to sqlite if there's no local record
                    if (!local) {
                        const dsp = new Date(plan.updated_at);
                        const formattedsp =
                            dsp.getFullYear() +
                            "-" +
                            String(dsp.getMonth() + 1).padStart(2, "0") +
                            "-" +
                            String(dsp.getDate()).padStart(2, "0") +
                            " " +
                            String(dsp.getHours()).padStart(2, "0") +
                            ":" +
                            String(dsp.getMinutes()).padStart(2, "0") +
                            ":" +
                            String(dsp.getSeconds()).padStart(2, "0");
                        await db.runAsync(
                            `INSERT INTO shop_plans (server_id, created_by, address, date_scheduled, budget, number_of_items, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
                            [
                                plan.id,
                                user.id,
                                plan.address,
                                plan.date_scheduled,
                                plan.budget,
                                plan.number_of_items,
                                plan.status,
                                formattedsp,
                                formattedsp,
                            ],
                        );
                    } else {
                        // update sqlite row if the server's updated_at is greater than the local's
                        const dsp = new Date(plan.updated_at);
                        const formattedsp =
                            dsp.getFullYear() +
                            "-" +
                            String(dsp.getMonth() + 1).padStart(2, "0") +
                            "-" +
                            String(dsp.getDate()).padStart(2, "0") +
                            " " +
                            String(dsp.getHours()).padStart(2, "0") +
                            ":" +
                            String(dsp.getMinutes()).padStart(2, "0") +
                            ":" +
                            String(dsp.getSeconds()).padStart(2, "0");

                        await db.runAsync(
                            `UPDATE shop_plans SET budget = ?, status = ?, updated_at = ? WHERE id = ?`,
                            [plan.budget, plan.status, formattedsp, local.id],
                        );
                    }

                    if (items) {
                        if (local) {
                            await db.runAsync(
                                `DELETE FROM items WHERE shop_plan_id = ?`,
                                local.id,
                            );
                        }

                        let query = `INSERT INTO items (server_id, shop_plan_id, name, price, expected_quantity, actual_quantity, created_at, updated_at) VALUES`;
                        let placeholders: string[] = [];
                        let values: any[] = [];
                        for (const item of items.data) {
                            const di = new Date(item.updated_at);
                            const formattedi =
                                di.getFullYear() +
                                "-" +
                                String(di.getMonth() + 1).padStart(2, "0") +
                                "-" +
                                String(di.getDate()).padStart(2, "0") +
                                " " +
                                String(di.getHours()).padStart(2, "0") +
                                ":" +
                                String(di.getMinutes()).padStart(2, "0") +
                                ":" +
                                String(di.getSeconds()).padStart(2, "0");

                            placeholders.push("(?,?,?,?,?,?,?,?)");
                            values.push(
                                item.id,
                                local.id,
                                item.name,
                                item.price,
                                item.expected_quantity,
                                item.actual_quantity,
                                formattedi,
                                formattedi,
                            );
                        }

                        query += placeholders.join(",");

                        // console.log("item query:", query);
                        // console.log("item values:", values);

                        await db.runAsync(query, values);
                    }
                }
            }
        }
    } catch (e: any) {
        console.log("error", e);
    } finally {
        isSyncing = false;
        // console.log("done syncing");
    }
}
