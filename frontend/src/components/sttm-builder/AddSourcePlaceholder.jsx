'use client';

export default function AddSourcePlaceholder({ onAdd }) {
  return (
    <div
      onClick={onAdd}
      className="
        flex justify-between items-center
        p-3 mb-2
        rounded-lg
        border-2 border-dashed border-gray-300
        bg-white
        cursor-pointer
        hover:border-blue-400
        hover:bg-blue-50
        transition
      "
      style={{ minHeight: '72px' }}   // matches source card height
    >
      {/* LEFT (mirrors card layout) */}
      <div className="flex items-center gap-3" style={{'min-width':'100%'}}>
        <div className="h-4 w-4 rounded border border-gray-300 flex items-center justify-center text-gray-400">
          +
        </div>

        <div>
          <div className="text-sm font-semibold text-gray-600">
            Add another source
          </div>
          <div className="text-xs text-gray-400">
            Select an additional source table
          </div>
        </div>
      </div>

      {/* RIGHT (empty spacing to match card metrics area) */}
      <div className="flex gap-6 opacity-0 select-none">
        <div>rows</div>
        <div>cols</div>
      </div>
    </div>
  );
}
``