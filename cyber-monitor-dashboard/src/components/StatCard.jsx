function StatCard({ title, value }) {

    return (

        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">

            <p className="text-xs text-gray-500 uppercase tracking-wider">
                {title}
            </p>

            <p className="text-2xl font-bold text-gray-900 mt-2">
                {value || 0}
            </p>

        </div>

    );

}

export default StatCard;