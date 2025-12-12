import { LightningElement, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { encodeDefaultFieldValues } from 'lightning/pageReferenceUtils';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

// Apex Controllers
import getAllObjects from '@salesforce/apex/CalendarWidgetController.getAllObjects';
import getAllFields from '@salesforce/apex/CalendarWidgetController.getAllFields';
import getDateFields from '@salesforce/apex/CalendarWidgetController.getDateFields';
import getFlexibleTitleFields from '@salesforce/apex/CalendarWidgetController.getFlexibleTitleFields'; 
import getUserReferenceFields from '@salesforce/apex/CalendarWidgetController.getUserReferenceFields';
import getEvents from '@salesforce/apex/CalendarWidgetController.getEvents';

// --- CONFIGURATION ---
const ENABLE_LOGS = true; // Set to FALSE to disable all console logs

export default class ScratchCalendar extends NavigationMixin(LightningElement) {
    @track currentDate = new Date();
    @track currentView = 'month'; 
    @track isSettingsOpen = false;
    @track currentSettingsTab = 'object';
    
    @track monthDays = [];
    @track weekDays = [];
    @track hours = [];

    // Dropdown Data
    @track objectOptions = [];
    @track allFieldsOptions = []; 
    @track dateFieldOptions = [];
    @track userFieldOptions = [];
    @track titleFieldOptions = [];
    @track titleTypeOptions = [];
    @track filteredTitleOptions = []; 

    // Saved Configuration
    @track selectedObject = localStorage.getItem('cal_obj') || 'Event';
    @track selectedStartField = localStorage.getItem('cal_start') || 'CreatedDate'; 
    @track selectedEndField = localStorage.getItem('cal_end') || '';
    @track selectedTitleType = ''; 
    @track selectedTitleField = localStorage.getItem('cal_title') || 'Id'; 

    // Theme Config
    @track colorGridHighlight = localStorage.getItem('cal_theme_grid') || '#faffbd';
    @track colorChip = localStorage.getItem('cal_theme_chip') || '#0176d3';
    @track colorChipHover = localStorage.getItem('cal_theme_chip_hover') || '#005fb2';
    @track colorToday = localStorage.getItem('cal_theme_today') || '#ebf7ff';

    // Filters
    @track selectedUserField = localStorage.getItem('cal_user') || ''; 
    @track dynamicFilters = []; 

    @track rawEvents = [];
    
    monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    defaultColors = { grid: '#faffbd', chip: '#0176d3', chipHover: '#005fb2', today: '#ebf7ff' };

    // --- LIFECYCLE ---
    connectedCallback() {
        this.log('Initializing...');
        this.loadFilters();
        this.fetchObjectData(); 
        this.renderView(); 
        this.refreshCalendar(); 
    }

    renderedCallback() { this.applyTheme(); }
    
    log(msg, data) { 
        if (ENABLE_LOGS) console.log(`[CAL] ${msg}`, data ? JSON.parse(JSON.stringify(data)) : ''); 
    }

    // --- GETTERS ---
    get currentMonthYear() { return `${this.monthNames[this.currentDate.getMonth()]} ${this.currentDate.getFullYear()}`; }
    get isMonthView() { return this.currentView === 'month'; }
    get isWeekView() { return this.currentView === 'week'; }
    get isDayView() { return this.currentView === 'day'; }
    get monthBtnVariant() { return this.currentView === 'month' ? 'brand' : 'neutral'; }
    get weekBtnVariant() { return this.currentView === 'week' ? 'brand' : 'neutral'; }
    get dayBtnVariant() { return this.currentView === 'day' ? 'brand' : 'neutral'; }
    
    get objectTabClass() { return `slds-vertical-tabs__nav-item ${this.currentSettingsTab === 'object' ? 'slds-is-active' : ''}`; }
    get themeTabClass() { return `slds-vertical-tabs__nav-item ${this.currentSettingsTab === 'theme' ? 'slds-is-active' : ''}`; }
    get isObjectTab() { return this.currentSettingsTab === 'object'; }
    get isThemeTab() { return this.currentSettingsTab === 'theme'; }
    get disableAddFilter() { return this.dynamicFilters && this.dynamicFilters.length >= 5; }

    // --- DATA FETCHING ---
    @wire(getAllObjects)
    wiredObjects({ error, data }) {
        if (data) {
            // Sort copy to prevent Proxy Error
            this.objectOptions = [...data].sort((a, b) => a.label.localeCompare(b.label));
        }
    }

    async fetchObjectData() {
        if(!this.selectedObject) return;
        try {
            const [dateFields, userFields, titleFields, allFields] = await Promise.all([
                getDateFields({ objectName: this.selectedObject }),
                getUserReferenceFields({ objectName: this.selectedObject }),
                getFlexibleTitleFields({ objectName: this.selectedObject }),
                getAllFields({ objectName: this.selectedObject })
            ]);

            this.dateFieldOptions = dateFields;
            this.userFieldOptions = userFields;
            this.allFieldsOptions = [...allFields].sort((a,b) => a.label.localeCompare(b.label));
            this.processTitleMetadata(titleFields);
        } catch (error) { console.error(error); }
    }

    processTitleMetadata(fields) {
        let types = new Set();
        fields.forEach(f => types.add(f.type));
        this.titleTypeOptions = Array.from(types).map(t => ({ label: t, value: t })).sort((a,b) => a.label.localeCompare(b.label));
        
        let savedFieldMeta = fields.find(f => f.value === this.selectedTitleField);
        if (savedFieldMeta) {
            this.selectedTitleType = savedFieldMeta.type;
        } else {
            this.selectedTitleField = 'Id';
            this.selectedTitleType = 'ID';
        }
        this.filterTitleOptions();
    }

    async filterTitleOptions() {
        try {
            const res = await getFlexibleTitleFields({ objectName: this.selectedObject });
            this.filteredTitleOptions = res.filter(f => f.type === this.selectedTitleType);
        } catch (e) { console.error(e); }
    }

    loadFilters() {
        const stored = localStorage.getItem('cal_filters');
        if (stored) {
            try {
                this.dynamicFilters = JSON.parse(stored);
            } catch(e) { this.dynamicFilters = []; }
        } else {
            this.dynamicFilters = [];
        }
        if (!Array.isArray(this.dynamicFilters)) this.dynamicFilters = [];
    }

    // --- FILTERS (Deep Clone Safe) ---
    addFilter() {
        if (this.dynamicFilters.length >= 5) return;
        // Deep clone to detach from Proxy
        let filters = JSON.parse(JSON.stringify(this.dynamicFilters));
        filters.push({ id: Date.now(), field: '', value: '', type: 'STRING', inputType: 'text' });
        this.dynamicFilters = filters;
    }

    removeFilter(event) {
        const index = parseInt(event.target.dataset.index, 10);
        let filters = JSON.parse(JSON.stringify(this.dynamicFilters));
        filters.splice(index, 1);
        this.dynamicFilters = filters;
    }

    handleFilterFieldChange(event) {
        const index = parseInt(event.target.dataset.index, 10);
        const fieldName = event.detail.value;
        const fieldMeta = this.allFieldsOptions.find(f => f.value === fieldName);
        
        let filters = JSON.parse(JSON.stringify(this.dynamicFilters));
        filters[index].field = fieldName;
        filters[index].type = fieldMeta ? fieldMeta.type : 'STRING';
        
        if (filters[index].type === 'DATE' || filters[index].type === 'DATETIME') filters[index].inputType = 'date';
        else if (filters[index].type === 'BOOLEAN') filters[index].inputType = 'checkbox';
        else if (filters[index].type === 'DOUBLE' || filters[index].type === 'INTEGER' || filters[index].type === 'CURRENCY') filters[index].inputType = 'number';
        else filters[index].inputType = 'text';

        filters[index].value = ''; 
        this.dynamicFilters = filters;
    }

    handleFilterValueChange(event) {
        const index = parseInt(event.target.dataset.index, 10);
        const val = event.target.type === 'checkbox' ? event.target.checked : event.detail.value;
        
        let filters = JSON.parse(JSON.stringify(this.dynamicFilters));
        filters[index].value = val;
        this.dynamicFilters = filters;
    }

    // --- MAIN LOGIC ---
    async refreshCalendar() {
        if(!this.selectedObject) return;
        const effectiveStartField = this.selectedStartField || 'CreatedDate';
        let cleanFilters = Array.isArray(this.dynamicFilters) ? this.dynamicFilters.filter(f => f.field && f.value !== '' && f.value !== null) : [];
        
        try {
            const data = await getEvents({
                objectName: this.selectedObject,
                startField: effectiveStartField,
                endField: this.selectedEndField,
                userField: this.selectedUserField,
                titleField: this.selectedTitleField,
                filterJson: JSON.stringify(cleanFilters)
            });

            this.rawEvents = data.map(record => {
                let title = (this.selectedTitleField && record[this.selectedTitleField]) ? record[this.selectedTitleField] : (record.Name || record.Id);
                let startVal = record[effectiveStartField];
                if(!startVal) return null; 
                let startDt = new Date(startVal);
                let endDt = (this.selectedEndField && record[this.selectedEndField]) ? new Date(record[this.selectedEndField]) : new Date(startDt);
                if(endDt < startDt) endDt = new Date(startDt);
                return { Id: record.Id, Title: title, Start: startDt, End: endDt };
            }).filter(e => e !== null); 
            
            this.renderView();
        } catch (error) {
            console.error(error);
            this.rawEvents = [];
            this.renderView();
        }
    }

    renderView() {
        if (this.currentView === 'month') this.generateMonthGrid();
        else if (this.currentView === 'week') this.generateWeekGrid();
        else if (this.currentView === 'day') this.generateDayGrid();
    }

    // --- GRID GENERATION ---
    generateMonthGrid() {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        let days = [];
        for (let i = 0; i < firstDay; i++) { days.push({ id: `prev-${i}`, class: 'day prev-month', label: '', events: [] }); }
        for (let i = 1; i <= daysInMonth; i++) {
            let currentDt = new Date(year, month, i);
            let isToday = (currentDt.toDateString() === new Date().toDateString());
            let dayEvents = this.rawEvents.filter(e => this.isEventOnDate(e, currentDt));
            let isoDateStr = currentDt.getFullYear() + '-' + String(currentDt.getMonth() + 1).padStart(2, '0') + '-' + String(currentDt.getDate()).padStart(2, '0');
            days.push({ id: `curr-${i}`, class: isToday ? 'day current-month today' : 'day current-month', label: i, isoDate: isoDateStr, events: dayEvents });
        }
        this.monthDays = days;
    }
    
    generateWeekGrid() {
        const curr = new Date(this.currentDate);
        const first = curr.getDate() - curr.getDay(); 
        let week = [];
        let weekDates = [];
        for (let i = 0; i < 7; i++) {
            let d = new Date(new Date(curr).setDate(first + i));
            weekDates.push(d);
            let isToday = d.toDateString() === new Date().toDateString();
            week.push({ id: `wd-${i}`, name: this.daysOfWeek[i], dateLabel: d.getDate(), columnClass: isToday ? 'week-header-cell today-column' : 'week-header-cell' });
        }
        this.weekDays = week;
        this.generateHoursWithSlots(weekDates);
    }

    generateDayGrid() { this.generateHoursWithSlots([this.currentDate]); }

    generateHoursWithSlots(datesForSlots) {
        let rows = [];
        const currentHour = new Date().getHours();
        const isTodayPage = this.currentDate.toDateString() === new Date().toDateString();

        for(let h=0; h<24; h++) {
            let hourLabel = (h % 12 || 12) + (h >= 12 ? ' PM' : ' AM');
            let isCurrentHourRow = (h === currentHour && isTodayPage && this.currentView === 'day'); 
            let rowSlots = [];
            datesForSlots.forEach((dateObj, index) => {
                let isTodayCol = dateObj.toDateString() === new Date().toDateString();
                let slotEvents = this.rawEvents.filter(e => this.isEventInSlot(e, dateObj, h));
                let createDt = new Date(dateObj);
                createDt.setHours(h);
                let isoStr = createDt.getFullYear() + '-' + String(createDt.getMonth() + 1).padStart(2, '0') + '-' + String(createDt.getDate()).padStart(2, '0') + 'T' + String(h).padStart(2, '0') + ':00:00.000Z';
                
                rowSlots.push({
                    id: `slot-${h}-${index}`,
                    class: isTodayCol ? 'week-slot today-column' : 'week-slot',
                    isoDate: isoStr,
                    events: slotEvents
                });
            });
            rows.push({ id: `row-${h}`, label: hourLabel, class: isCurrentHourRow ? 'time-row current-hour-highlight' : 'time-row', weekSlots: rowSlots, dayEvents: rowSlots[0]?.events, dayIsoDate: rowSlots[0]?.isoDate });
        }
        this.hours = rows;
    }

    isEventOnDate(event, targetDate) {
        const tDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate()).getTime();
        const sDate = new Date(event.Start.getFullYear(), event.Start.getMonth(), event.Start.getDate()).getTime();
        const eDate = new Date(event.End.getFullYear(), event.End.getMonth(), event.End.getDate()).getTime();
        return tDate >= sDate && tDate <= eDate;
    }

    isEventInSlot(event, targetDate, hour) {
        let slotStart = new Date(targetDate);
        slotStart.setHours(hour, 0, 0, 0);
        let slotEnd = new Date(targetDate);
        slotEnd.setHours(hour, 59, 59, 999);
        return (event.Start <= slotEnd) && (event.End >= slotStart);
    }

    // --- ACTIONS ---
    handleGridClick(event) {
        let dateStr = event.currentTarget.dataset.date;
        if(!dateStr) return;
        this.log('Grid Clicked', dateStr);
        
        let targetField = this.selectedStartField || 'CreatedDate';
        let defaults = {};
        if(targetField !== 'CreatedDate' && targetField !== 'LastModifiedDate') {
             defaults[targetField] = dateStr;
             if(this.selectedEndField && this.selectedEndField !== 'CreatedDate' && this.selectedEndField !== 'LastModifiedDate') {
                 defaults[this.selectedEndField] = dateStr;
             }
        }
        const defaultValues = encodeDefaultFieldValues(defaults);
        this[NavigationMixin.Navigate]({ type: 'standard__objectPage', attributes: { objectApiName: this.selectedObject, actionName: 'new' }, state: { defaultFieldValues: defaultValues } });
    }

    handleEventClick(event) {
        event.stopPropagation();
        this[NavigationMixin.Navigate]({ type: 'standard__recordPage', attributes: { recordId: event.currentTarget.dataset.id, objectApiName: this.selectedObject, actionName: 'view' } });
    }

    showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    applyTheme() {
        const container = this.template.querySelector('.main-container');
        if(container) {
            container.style.setProperty('--theme-today-bg', this.colorToday);
            container.style.setProperty('--theme-grid-hover', this.colorGridHighlight);
            container.style.setProperty('--theme-chip-bg', this.colorChip);
            container.style.setProperty('--theme-chip-hover', this.colorChipHover);
        }
    }

    // --- SETTINGS ---
    openSettings() { this.isSettingsOpen = true; }
    closeSettings() { this.isSettingsOpen = false; }
    switchSettingsTab(e) { e.preventDefault(); this.currentSettingsTab = e.currentTarget.dataset.tab; }
    
    handleObjectChange(e) { 
        this.selectedObject = e.detail.value; 
        this.selectedStartField = 'CreatedDate'; this.selectedEndField = ''; this.selectedUserField = ''; this.selectedTitleField = 'Id';
        this.dynamicFilters = []; 
        this.fetchObjectData(); 
    }
    handleStartChange(e) { this.selectedStartField = e.detail.value; }
    handleEndChange(e) { this.selectedEndField = e.detail.value; }
    handleUserFieldChange(e) { this.selectedUserField = e.detail.value; }
    handleTitleTypeChange(e) { this.selectedTitleType = e.detail.value; this.filterTitleOptions(); }
    handleTitleFieldChange(e) { this.selectedTitleField = e.detail.value; }
    handleColorChange(e) { this[e.target.dataset.id] = e.detail.value; }
    resetColor(e) { this[e.target.dataset.id] = this.defaultColors[e.target.dataset.key]; }

    previous() { this.changeDate(-1); }
    next() { this.changeDate(1); }
    today() { this.currentDate = new Date(); this.renderView(); }
    
    // FIX: Using value instead of dataset.view ensures buttons work correctly
    setView(e) { 
        this.currentView = e.target.value; 
        this.renderView(); 
    }

    changeDate(dir) {
        const dt = new Date(this.currentDate);
        if (this.currentView === 'month') dt.setMonth(dt.getMonth() + dir);
        else if (this.currentView === 'week') dt.setDate(dt.getDate() + (dir * 7));
        else dt.setDate(dt.getDate() + dir);
        this.currentDate = dt;
        this.renderView(); 
    }

    saveSettings() {
        if (!this.selectedObject || !this.selectedStartField || !this.selectedTitleType || !this.selectedTitleField) {
            this.showToast('Missing Fields', 'Please select Object, Start Date, and Title Field.', 'error');
            return;
        }
        try {
            localStorage.setItem('cal_obj', this.selectedObject);
            localStorage.setItem('cal_start', this.selectedStartField); 
            localStorage.setItem('cal_end', this.selectedEndField);
            localStorage.setItem('cal_user', this.selectedUserField);
            localStorage.setItem('cal_title', this.selectedTitleField);
            localStorage.setItem('cal_theme_grid', this.colorGridHighlight);
            localStorage.setItem('cal_theme_chip', this.colorChip);
            localStorage.setItem('cal_theme_chip_hover', this.colorChipHover);
            localStorage.setItem('cal_theme_today', this.colorToday);
            localStorage.setItem('cal_filters', JSON.stringify(this.dynamicFilters));
            
            this.closeSettings();
            this.refreshCalendar();
            this.applyTheme();
            this.showToast('Success', 'Settings Saved', 'success');
        } catch(e) { console.error(e); }
    }
}