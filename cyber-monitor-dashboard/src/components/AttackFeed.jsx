function StatCard({ title, value }) {

    return (
        <div className="bg-white border border-gray-200 rounded-xl p-5">

            <p className="text-xs text-gray-500 uppercase">
                {title}
            </p>

            <h2 className="text-3xl font-bold mt-2 text-gray-900">
                {value}
            </h2>

        </div>
    );
}

export default StatCard;