const fs = require('fs');
async function test() {
    let allMovies = [];
    let page = 1;
    let hasMore = true;
    
    while(hasMore && page <= 5) {
        const res = await fetch(`http://localhost:5173/api/list?channelId=0&page=${page}`);
        const items = await res.json();
        
        const validItems = items.filter((item) => {
            const hasCover = item.cover && (item.cover.url || typeof item.cover === 'string');
            return hasCover && (item.subjectType === 1 || item.subjectType === 2 || !item.subjectType);
        });
        
        const existingIds = new Set(allMovies.map(m => m.id || m.subjectId));
        const newItems = validItems.filter(item => !existingIds.has(item.id || item.subjectId));
        
        console.log(`Page ${page}: fetched ${items.length}, valid ${validItems.length}, new ${newItems.length}`);
        
        if (page === 1) {
            allMovies = validItems;
            hasMore = validItems.length > 0;
        } else {
            if (validItems.length > 0 && newItems.length === 0) {
                hasMore = false;
            } else {
                hasMore = items.length > 0;
            }
            allMovies = [...allMovies, ...newItems];
        }
        page++;
    }
    console.log(`Total movies: ${allMovies.length}`);
}
test();
