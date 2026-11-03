/** @type {import('next').NextConfig} */
const localDevOrigins = process.env.NODE_ENV === "development"
	? Object.values(require("node:os").networkInterfaces()).flat()
		.filter((entry) => entry?.family === "IPv4")
		.map((entry) => entry.address)
	: [];

const nextConfig = {
	reactStrictMode: true,
	allowedDevOrigins: ["localhost", ...localDevOrigins],
	env: {
		NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
		NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
	},
};

module.exports = nextConfig;
