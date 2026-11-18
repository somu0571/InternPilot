function parseISTEndOfDay(dateString) {
    if (!dateString || dateString.trim() === '') {
        return null; 
    }

    
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateString)) {
        throw new Error('Invalid deadline format. Expected YYYY-MM-DD');
    }

    const d = new Date(dateString); 
    if (isNaN(d.getTime())) {
        throw new Error('Invalid date value');
    }

    
    
    d.setUTCHours(18, 29, 59, 999);
    
    return d;
}

function parseISTDatetime(datetimeString) {
    if (!datetimeString || datetimeString.trim() === '') {
        throw new Error('Interview date and time are required.');
    }
    
    const regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
    if (!regex.test(datetimeString)) {
        throw new Error('Invalid datetime format. Expected YYYY-MM-DDTHH:MM');
    }
    
    const [datePart, timePart] = datetimeString.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hours, minutes] = timePart.split(':').map(Number);

    
    const d = new Date(Date.UTC(year, month - 1, day, hours - 5, minutes - 30));
    if (isNaN(d.getTime())) {
        throw new Error('Invalid date/time value');
    }
    return d;
}

module.exports = { parseISTEndOfDay, parseISTDatetime };
