import { readRepoJson, readDatabase } from "../_github.js";

function normalizeList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : (value ? [value] : []);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ success:false, message:"Method tidak diizinkan." });

  try {
    const [{ data: distributor }, { database }] = await Promise.all([
      readRepoJson("distributor.json"),
      readDatabase()
    ]);

    const config = distributor || {};
    const users = Array.isArray(database?.users) ? database.users : [];

    // Developer & Owner dan Admin berasal dari distributor.json.
    // Keduanya menerima object tunggal maupun array agar fleksibel.
    const developerOwner = normalizeList(config.developerOwner);
    const admin = normalizeList(config.admin);

    // Reseller selalu dinamis dari database: hanya user dengan reseller === true.
    // Password/passwordHash/token tidak pernah dikirim ke browser.
    const reseller = users
      .filter(user => user?.reseller === true)
      .map(user => ({
        role: "Reseller",
        name: user.displayName || user.username || user.email || "Reseller",
        photo: user.avatar || "",
        socials: user.socials || (user.instagram ? { instagram: user.instagram } : {})
      }));

    return res.status(200).json({
      success:true,
      distributor: { developerOwner, admin, reseller }
    });
  } catch (error) {
    console.error("Distributor API error:", error);
    return res.status(500).json({ success:false, message:"Gagal mengambil data distributor." });
  }
}
