function AttackFeed({ logs }) {
  if (!logs || logs.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-8">
        <h3 className="text-lg font-bold mb-4">Live Attack Feed</h3>
        <p className="text-gray-400 text-sm text-center py-8">
          Waiting for live events...
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6">
      <h3 className="text-lg font-bold mb-4">Live Attack Feed</h3>

      <div className="space-y-3 max-h-[400px] overflow-y-auto">
        {logs.map((log, i) => (
          <div
            key={`${log.ip_address}-${log.timestamp}-${i}`}
            className="flex items-center gap-4 p-3 bg-gray-50 border border-gray-100 rounded-lg"
          >
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse shrink-0" />

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-mono text-red-600 font-bold text-sm">
                  {log.ip_address}
                </span>
                {log.vm_id && (
                  <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs">
                    {log.vm_id}
                  </span>
                )}
              </div>
              <div className="flex gap-4 text-xs text-gray-500 mt-1">
                <span>User: {log.username || "unknown"}</span>
                {log.timestamp && (
                  <span>
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default AttackFeed;
