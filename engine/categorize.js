// engine/categorize.js
// 将排序后的专业列表划分为「冲/稳/保/避」四级

function categorize(sortedList) {
  const len = sortedList.length;

  if (len <= 3) {
    return {
      reach: sortedList.slice(0, 1),
      match: sortedList.slice(1, 2),
      safety: sortedList.slice(2),
      avoid: []
    };
  }

  return {
    reach: sortedList.slice(0, 2),
    match: sortedList.slice(2, 5),
    safety: sortedList.slice(5, 8),
    avoid: sortedList.slice(8)
  };
}

module.exports = categorize;
