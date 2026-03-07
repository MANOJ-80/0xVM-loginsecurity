function StatCard({ title, value, color = "text-gray-900" }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
      <p className="text-xs text-gray-500 uppercase tracking-wider">{title}</p>
      <p className={`text-2xl font-bold mt-2 ${color}`}>{value ?? 0}</p>
    </div>
  );
}

export default StatCard;