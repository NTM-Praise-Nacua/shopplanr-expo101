import * as SQLite from "expo-sqlite";
import { validateShopPlanCreate, validateUpdateShopPlan } from "./validator";

export let dbPromise = SQLite.openDatabaseAsync("shopplanr.db");

// export interface ShopPlanList {
//     id: number;
//     address: string;
//     date_scheduled: string;
//     budget: number;
//     number_of_items: number;
//     status: number;
// }
export interface ShopPlan {
    id?: number;
    address: string;
    date_scheduled: string;
    budget: number;
    number_of_items: number;
    status: number;
    in_progress?: number;
    items?: Item[];
    created_by?: number;
}

export interface ShopPlanCreate {
    address: string;
    date_scheduled: string;
    budget: number;
    number_of_items: number;
    status: number;
    items: Item[];
    created_by: number;
}

export interface Item {
    id?: number;
    shop_plan_id?: number;
    name: string;
    price: number;
    expected_quantity: number;
    actual_quantity: number;
}

interface TableRow {
    name: string;
    sql?: string;
}

interface TableColumn {
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
    pk: number;
}

export interface UserType {
    first_name: string;
    last_name: string;
    email: string;
    password: string;
}

interface PendingOperation {
    entity_type: string;
    entity_id: string;
    operation_type: string;
    payload: string;
}

interface ShopPlanType {
    id: number;
    address: string;
    date_scheduled: string;
    budget: number;
    number_of_items: number;
    status: number;
}

interface ItemType {
    id: number;
    shop_plan_id: number;
    name: string;
    price: number;
    expected_quantity: number;
    actual_quantity: number;
}

interface ShowShopPlan {
    shop_plan_info: ShopPlanType;
    shop_plan_items: ItemType[];
}

interface UpdateItem {
    id: number;
    name: string;
    price: number;
    actual_quantity: number;
}

export interface UpdateShopPlan {
    shop_plan_id: number;
    status: number;
    budget: number;
    items: UpdateItem[];
}

export const initDB = async () => {
    const db = await dbPromise;

    await db.execAsync(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY NOT NULL,
            first_name TEXT,
            last_name TEXT,
            full_name TEXT,
            email TEXT UNIQUE,
            password TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS shop_plans (
            id INTEGER PRIMARY KEY NOT NULL,
            server_id INTEGER,
            created_by INTEGER,
            address TEXT,
            date_scheduled TEXT, 
            budget REAL,
            number_of_items INTEGER,
            status INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(created_by) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY NOT NULL,
            server_id INTEGER,
            shop_plan_id INTEGER,
            name TEXT,
            price REAL,
            expected_quantity INTEGER,
            actual_quantity INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(shop_plan_id) REFERENCES shop_plans(id)
        );

        CREATE TABLE IF NOT EXISTS pending_operations (
            id INTEGER PRIMARY KEY NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            operation_type TEXT NOT NULL,
            payload TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            attempts INTEGER DEFAULT 0,
            last_error TEXT
        );
    `);
};

export const showData = async (): Promise<any> => {
    try {
        const db = await dbPromise;

        // const rowsToUpdate: { id: number }[] = await db.getAllAsync(
        //     `SELECT id FROM shop_plans WHERE created_by = ? AND status IN (0,1) AND date_scheduled < datetime('now', 'localtime', 'start of day')`,
        //     userId,
        // );

        // return rowsToUpdate;
        // return await db.getAllAsync(`SELECT * FROM pending_operations`);
        const shopplans = await db.getAllAsync<any>(`SELECT * FROM shop_plans`);
        const items = await db.getAllAsync<any>(`SELECT * FROM items`);

        return {
            plans: shopplans,
            items: items,
        };
    } catch (error) {
        console.error("error:", error);
    }
};

export const resetDB = async () => {
    const db = await dbPromise;

    await db.execAsync(`
        DROP TABLE IF EXISTS pending_operations;
        DROP TABLE IF EXISTS items;
        DROP TABLE IF EXISTS shop_plans;
        DROP TABLE IF EXISTS users;
    `);
};

export const shopPlanList = async (userId: number): Promise<ShopPlan[]> => {
    try {
        const db = await dbPromise;

        const rowsToUpdate: { id: number; server_id: number }[] =
            await db.getAllAsync(
                `SELECT id, server_id FROM shop_plans WHERE created_by = ? AND status IN (0,1) AND date_scheduled < datetime('now', 'start of day')`,
                userId,
            );

        if (rowsToUpdate.length > 0) {
            await db.runAsync(
                `UPDATE shop_plans SET status = 3, updated_at = CURRENT_TIMESTAMP WHERE id IN (${rowsToUpdate.map(() => "?").join(",")})`,
                rowsToUpdate.map((r) => r.id),
            );
        }

        return await db.getAllAsync(
            `SELECT id, address, date_scheduled, budget, number_of_items, status FROM shop_plans WHERE created_by = ? ORDER BY created_at DESC`,
            userId,
        );
    } catch (error) {
        console.error("error", error);
        throw error;
    }
};

export const insertPendingOperation = async (
    { entity_type, entity_id, operation_type, payload }: PendingOperation,
    rowsToUpdate: { id: number }[],
) => {
    try {
        const db = await dbPromise;

        if (entity_id != "0") {
            await db.runAsync(
                `INSERT INTO pending_operations (entity_type, entity_id, operation_type, payload) VALUES(?,?,?,?)`,
                [entity_type, entity_id, operation_type, payload],
            );
        } else {
            for (const row of rowsToUpdate) {
                await db.runAsync(
                    `INSERT INTO pending_operations (entity_type, entity_id, operation_type, payload) VALUES(?,?,?,?)`,
                    [entity_type, row.id, operation_type, payload],
                );
            }
        }
    } catch (error) {
        console.error("error:", error);
    }
};

export const createShopPlan = async ({
    address,
    date_scheduled,
    budget,
    number_of_items,
    status = 0,
    created_by,
    items,
}: ShopPlanCreate): Promise<ShopPlan> => {
    validateShopPlanCreate({
        address,
        date_scheduled,
        budget,
        status,
        number_of_items,
        created_by,
        items,
    });

    const db = await dbPromise;
    await db.execAsync("BEGIN TRANSACTION");

    try {
        const result = await db.runAsync(
            `INSERT INTO shop_plans (created_by, address, date_scheduled, budget, number_of_items, status) VALUES(?,?,?,?,?,?)`,
            [
                created_by,
                address,
                date_scheduled,
                budget,
                number_of_items,
                status,
            ],
        );

        if (!result.lastInsertRowId)
            throw new Error("Shop Plan Creation Failed");

        // const operation_shop_plan = {
        //     entity_type: "shop_plans",
        //     entity_id: result.lastInsertRowId.toString(),
        //     operation_type: "insert",
        //     payload: JSON.stringify({
        //         created_by: created_by,
        //         address: address,
        //         date_scheduled: date_scheduled,
        //         budget: budget,
        //         number_of_items: number_of_items,
        //         status: status,
        //     }),
        // };
        // await insertPendingOperation(operation_shop_plan, []);

        let query = `INSERT INTO items (shop_plan_id, name, price, expected_quantity, actual_quantity) VALUES`;
        let values: any[] = [];
        let placeholders: string[] = [];
        let payload: Omit<ItemType, "id">[] = [];
        items.forEach((item) => {
            placeholders.push("(?,?,?,?,?)");
            values.push(
                result.lastInsertRowId,
                item.name,
                item.price,
                item.expected_quantity,
                item.actual_quantity,
            );
            payload.push({
                shop_plan_id: result.lastInsertRowId,
                name: item.name,
                price: item.price,
                expected_quantity: item.expected_quantity,
                actual_quantity: item.actual_quantity,
            });
        });

        query += placeholders.join(",");

        const result_items = await db.runAsync(query, values);

        if (!result_items.lastInsertRowId)
            throw new Error("Failed to insert Items");

        const rowsToUpdate: { id: number }[] = await db.getAllAsync(
            `SELECT id FROM items WHERE shop_plan_id = ?`,
            result.lastInsertRowId,
        );

        // console.log("values: ", values);
        if (rowsToUpdate.length > 0) {
            rowsToUpdate.forEach((item: any) => {
                payload = payload.map((obj) => ({
                    ...obj,
                    id: item.id,
                }));
            });
        }

        const operation_shop_plan = {
            entity_type: "shop_plans",
            entity_id: result.lastInsertRowId.toString(),
            operation_type: "insert",
            payload: JSON.stringify({
                created_by: created_by,
                address: address,
                date_scheduled: date_scheduled,
                budget: budget,
                number_of_items: number_of_items,
                status: status,
                items: payload,
            }),
        };

        await insertPendingOperation(operation_shop_plan, []);
        // const operation_items = {
        //     entity_type: "items",
        //     entity_id: "0",
        //     operation_type: "insert",
        //     payload: JSON.stringify(payload),
        // };
        // await insertPendingOperation(operation_items, rowsToUpdate);

        await db.execAsync("COMMIT");

        return {
            id: result.lastInsertRowId,
            address,
            date_scheduled,
            budget,
            number_of_items,
            status,
        };
    } catch (error) {
        await db.execAsync("ROLLBACK");
        throw error;
    }
};

export const showShopPlan = async (
    shop_plan_id: number,
): Promise<ShowShopPlan> => {
    try {
        const db = await dbPromise;

        const shop_plan_info = await db.getFirstAsync<ShopPlanType>(
            `
            SELECT id, address, date_scheduled, budget, number_of_items, status FROM shop_plans WHERE id = ?
        `,
            shop_plan_id,
        );

        if (!shop_plan_info) {
            throw new Error("Shop Plan not found");
        }

        const shop_plan_items = await db.getAllAsync<ItemType>(
            `
            SELECT id, shop_plan_id, name, price, expected_quantity, actual_quantity FROM items WHERE shop_plan_id = ?
        `,
            shop_plan_id,
        );

        if (!shop_plan_items || shop_plan_items.length <= 0)
            throw new Error("Item Lists not found");

        return {
            shop_plan_info: shop_plan_info,
            shop_plan_items: shop_plan_items,
        };
    } catch (error) {
        console.error("error", error);
        throw error;
    }
};

export const updateShopPlan = async ({
    shop_plan_id,
    budget,
    status,
    items,
}: UpdateShopPlan): Promise<boolean> => {
    try {
        validateUpdateShopPlan({ shop_plan_id, status, budget, items });

        const db = await dbPromise;

        await db.runAsync(
            `UPDATE shop_plans SET status = ?, budget = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [status, budget, shop_plan_id],
        );

        let payloadItems: Omit<UpdateItem, "id">[] = [];

        const now = new Date().toISOString();
        for (const item of items) {
            await db.runAsync(
                `UPDATE items SET price = ?, actual_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [item.price, item.actual_quantity, item.id],
            );

            payloadItems.push({
                name: item.name,
                price: item.price,
                actual_quantity: item.actual_quantity,
            });
        }

        const shop_plan = await db.getFirstAsync<{ server_id: number }>(
            `SELECT server_id FROM shop_plans WHERE id = ? LIMIT 1`,
            shop_plan_id,
        );

        if (shop_plan) {
            const pending_operations = {
                entity_type: "shop_plans",
                entity_id: shop_plan.server_id.toString(),
                operation_type: "update",
                payload: JSON.stringify({
                    status: status,
                    budget: budget,
                    updated_at: now
                        .replace("T", " ")
                        .replace("Z", "")
                        .split(".")[0],
                    items: payloadItems,
                }),
            };

            await insertPendingOperation(pending_operations, []);
        }

        return true;
    } catch (error) {
        console.error("error", error);
        return false;
    }
};

export const startShopPlan = async (shop_plan_id: number): Promise<boolean> => {
    try {
        if (!shop_plan_id || !Number.isInteger(shop_plan_id))
            throw new Error("ID is required and must be an integer");

        const db = await dbPromise;

        const row = await db.getFirstAsync(
            `SELECT 1 FROM shop_plans WHERE status = 1 LIMIT 1`,
        );

        if (row) return false;

        const result = await db.runAsync(
            `UPDATE shop_plans SET status = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            shop_plan_id,
        );
        // console.log("shopplanid", shop_plan_id);
        const shopplanNew = await db.getFirstAsync(
            `SELECT * FROM shop_plans WHERE id = ?`,
            shop_plan_id,
        );
        // console.log("shop plan updated: ", shopplanNew);

        if (!result.lastInsertRowId)
            throw new Error("Failed to In-Progress Shop Plan");

        const server_id = await db.getFirstAsync<{
            server_id: number | null;
            updated_at: string;
        }>(
            `SELECT server_id, updated_at FROM shop_plans WHERE id = ?`,
            shop_plan_id,
        );

        if (server_id) {
            let payload: {
                status: number;
                server_id: number | null;
                updated_at: string;
            } = {
                status: 1,
                server_id: server_id.server_id,
                updated_at: server_id.updated_at,
            };
            const pending_operations = {
                entity_type: "shop_plans",
                entity_id: shop_plan_id.toString(),
                operation_type: "start",
                payload: JSON.stringify(payload),
            };

            await insertPendingOperation(pending_operations, []);
        }

        return true;
    } catch (error) {
        console.error("error", error);
        throw error;
    }
};
