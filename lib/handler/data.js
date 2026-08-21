import {
    readDatabase
} from "../_github.js";

export default async function handler(req, res) {
    try {
        const {
            database
        } = await readDatabase();

        res.status(200).json({
            success: true,
            data: database
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Gagal mengambil database."
        });
    }
}
