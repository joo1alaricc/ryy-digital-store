import { readRepoJson } from "../_github.js";
import { normalizeProduct } from "../_store.js";

const PRODUCTS_PATH = "produk.json";

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({
            success: false,
            message: "Method tidak diizinkan."
        });
    }

    try {
        const { data } = await readRepoJson(PRODUCTS_PATH);

        const products = Array.isArray(data?.products) ? data.products.map(normalizeProduct) : [];
        const categories = Array.isArray(data?.categories) ? data.categories : ["Semua"];
        const storeInfo = data?.storeInfo && typeof data.storeInfo === "object"
            ? data.storeInfo
            : {};

        return res.status(200).json({
            success: true,
            storeInfo,
            categories,
            products
        });
    } catch (error) {
        console.error("Products API error:", error);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil produk dari produk.json."
        });
    }
}

// RYY STORE: products API reads produk.json directly.
