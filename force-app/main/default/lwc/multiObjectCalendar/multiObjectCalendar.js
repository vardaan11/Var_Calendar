import { LightningElement, track, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { encodeDefaultFieldValues } from 'lightning/pageReferenceUtils';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';

import getAllObjects from '@salesforce/apex/MultiCalendarController.getAllObjects';
import getAllFields from '@salesforce/apex/MultiCalendarController.getAllFields';
import getDateFields from '@salesforce/apex/MultiCalendarController.getDateFields';
import getFlexibleTitleFields from '@salesforce/apex/MultiCalendarController.getFlexibleTitleFields'; 
import getUserReferenceFields from '@salesforce/apex/MultiCalendarController.getUserReferenceFields';
import getEvents from '@salesforce/apex/MultiCalendarController.getEvents';

const ENABLE_LOGS = true;
const SELECT_AT_CREATION_KEY = '__SELECT_AT_CREATION__';

const OBJECT_ICONS = {
    'Event': 'standard:event', 'Task': 'standard:task', 'Account': 'standard:account',
    'Contact': 'standard:contact', 'Lead': 'standard:lead', 'Opportunity': 'standard:opportunity',
    'Case': 'standard:case', 'Campaign': 'standard:campaign', 'Product2': 'standard:product',
    'User': 'standard:user', 'Contract': 'standard:contract'
};

// Hardcoded defaults for standard object creation fields
const DEFAULT_RECORD_FIELDS = {
    'Event': { start: 'StartDateTime', end: 'EndDateTime' },
    'Task': { start: 'ActivityDate', end: null },
    'Opportunity': { start: 'CloseDate', end: null },
    'Campaign': { start: 'StartDate', end: 'EndDate' },
    'Contract': { start: 'StartDate', end: 'EndDate' },
    'Quote': { start: 'ExpirationDate', end: null },
    'Order': { start: 'EffectiveDate', end: 'EndDate' }
};


export default class MultiObjectCalendar extends NavigationMixin(LightningElement) {
    @track currentDate = new Date();
    @track currentView = 'month'; 
    @track isSettingsOpen = false;
    @track currentSettingsTab = 'object';
    
    @track monthDays = [];
    @track weekDays = [];
    @track hours = [];

    @track calendarSources = [];
    @track currentSource = {}; 
    @track isEditingSource = false; 

    @track objectOptions = [];
    @track allFieldsOptions = []; 
    @track dateFieldOptions = [];
    @track userFieldOptions = [];
    @track titleFieldOptions = [];
    @track titleTypeOptions = [];
    @track filteredTitleOptions = []; 

    @track selectedObjectIcon = 'standard:sobject';

    // Theme Settings
    @track colorGridHighlight = localStorage.getItem('multi_cal_grid') || '#faffbd';
    @track colorToday = localStorage.getItem('multi_cal_today') || '#ebf7ff';
    @track maxRecordsPerDay = localStorage.getItem('multi_cal_max_records') ? parseInt(localStorage.getItem('multi_cal_max_records'), 10) : 4;

    // Record Creation Settings
    @track selectedCreationObject = localStorage.getItem('multi_cal_creation_obj') || SELECT_AT_CREATION_KEY;
    @track showCreationModal = false;
    @track clickedGridDate = null;

    @track rawEvents = [];
    
    // Shared Popover State
    @track isPopoverOpen = false;
    @track popoverLabel = '';
    @track popoverEvents = [];
    @track popoverStyle = '';
    
    monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    defaultColors = { grid: '#faffbd', today: '#ebf7ff', maxRecords: 4 };

    connectedCallback() {
        this.loadSettings();
        this.renderView(); 
        this.refreshCalendar(); 
    }

    renderedCallback() { this.applyTheme(); }
    log(msg, data) { if (ENABLE_LOGS) console.log(`[MULTI-CAL] ${msg}`, data ? JSON.parse(JSON.stringify(data)) : ''); }

    get currentMonthYear() { return `${this.monthNames[this.currentDate.getMonth()]} ${this.currentDate.getFullYear()}`; }
    get isMonthView() { return this.currentView === 'month'; }
    get isWeekView() { return this.currentView === 'week'; }
    get isDayView() { return this.currentView === 'day'; }
    get monthBtnVariant() { return this.currentView === 'month' ? 'brand' : 'neutral'; }
    get weekBtnVariant() { return this.currentView === 'week' ? 'brand' : 'neutral'; }
    get dayBtnVariant() { return this.currentView === 'day' ? 'brand' : 'neutral'; }
    
    get objectTabClass() { return `slds-vertical-tabs__nav-item ${this.currentSettingsTab === 'object' ? 'slds-is-active' : ''}`; }
    get themeTabClass() { return `slds-vertical-tabs__nav-item ${this.currentSettingsTab === 'theme' ? 'slds-is-active' : ''}`; }
    get creationTabClass() { return `slds-vertical-tabs__nav-item ${this.currentSettingsTab === 'creation' ? 'slds-is-active' : ''}`; }
    get isObjectTab() { return this.currentSettingsTab === 'object'; }
    get isThemeTab() { return this.currentSettingsTab === 'theme'; }
    get isCreationTab() { return this.currentSettingsTab === 'creation'; }

    get disableAddFilter() { return this.currentSource.filters && this.currentSource.filters.length >= 5; }

    get creationRadioOptions() {
        const options = [{ label: 'Decide on click (opens selection popup)', value: SELECT_AT_CREATION_KEY }];
        this.calendarSources.filter(s => s.isActive !== false).forEach(s => {
             options.push({ label: `Always create ${s.objectLabel}`, value: s.objectName });
        });
        return options;
    }

    get creationModalOptions() {
        return this.calendarSources
            .filter(s => s.isActive !== false)
            .map(s => ({
                ...s,
                iconName: OBJECT_ICONS[s.objectName] || 'standard:sobject'
            }));
    }

    @wire(getAllObjects)
    wiredObjects({ error, data }) {
        if (data) {
            this.objectOptions = [...data].sort((a, b) => a.label.localeCompare(b.label));
            this.refreshSourceLabels();
        }
    }

    async fetchMetadataForSource(objectName) {
        if(!objectName) return;
        try {
            const [dateFields, userFields, titleFields, allFields] = await Promise.all([
                getDateFields({ objectName }),
                getUserReferenceFields({ objectName }),
                getFlexibleTitleFields({ objectName }),
                getAllFields({ objectName })
            ]);

            this.dateFieldOptions = dateFields;
            this.userFieldOptions = userFields;
            this.allFieldsOptions = [...allFields].sort((a,b) => a.label.localeCompare(b.label));
            
            let rawTitles = [...titleFields];
            let types = new Set();
            rawTitles.forEach(f => types.add(f.type));
            this.titleTypeOptions = Array.from(types).map(t => ({ label: t, value: t })).sort((a,b) => a.label.localeCompare(b.label));
            
            let type = this.currentSource.titleType || 'ID';
            this.filteredTitleOptions = rawTitles.filter(f => f.type === type);
            
            this.selectedObjectIcon = OBJECT_ICONS[objectName] || 'standard:sobject';

        } catch (error) { console.error(error); }
    }

    addNewSource() {
        this.currentSource = {
            id: Date.now(),
            isActive: true,
            objectName: '', objectLabel: '', 
            startField: 'CreatedDate', endField: '',
            titleType: 'ID', titleField: 'Id',
            userField: '', color: '#0176d3', 
            filters: [], filterLogic: ''
        };
        this.selectedObjectIcon = 'standard:sobject';
        this.isEditingSource = true;
    }

    editSource(event) {
        const sourceId = event.currentTarget.dataset.id;
        const sourceToEdit = this.calendarSources.find(s => s.id == sourceId);
        if(sourceToEdit) {
            this.currentSource = JSON.parse(JSON.stringify(sourceToEdit));
            this.fetchMetadataForSource(this.currentSource.objectName);
            this.isEditingSource = true;
        }
    }

    toggleActive(event) {
        const sourceId = event.target.dataset.id;
        const checked = event.target.checked;
        
        let newSources = JSON.parse(JSON.stringify(this.calendarSources));
        const idx = newSources.findIndex(s => s.id == sourceId);
        if (idx >= 0) {
            newSources[idx].isActive = checked;
            newSources[idx].colorStyle = `display:block; width:24px; height:24px; border-radius:4px; background-color:${newSources[idx].color}; border:1px solid #c9c7c5; opacity: ${checked ? 1 : 0.4}`;
        }
        this.calendarSources = newSources;
        this.saveAllSettings();
    }

    deleteSource(event) {
        const sourceId = event.currentTarget.dataset.id;
        let raw = JSON.parse(JSON.stringify(this.calendarSources));
        let filtered = raw.filter(s => s.id != sourceId);
        this.calendarSources = this.processSourcesForDisplay(filtered);
        this.saveAllSettings();
    }

    cancelEdit(event) {
        if (event && event.preventDefault) event.preventDefault();
        this.isEditingSource = false;
        this.currentSource = {};
    }

    saveCurrentSource() {
        if (!this.currentSource.objectName || !this.currentSource.startField || !this.currentSource.titleField) {
            this.showToast('Missing Fields', 'Please select Object, Start Date, and Title Field.', 'error');
            return;
        }
        let newSources = JSON.parse(JSON.stringify(this.calendarSources));
        const existingIndex = newSources.findIndex(s => s.id === this.currentSource.id);
        
        if (existingIndex >= 0) newSources[existingIndex] = this.currentSource;
        else newSources.push(this.currentSource);
        
        this.calendarSources = this.processSourcesForDisplay(newSources);
        this.isEditingSource = false;
        this.saveAllSettings();
    }

    processSourcesForDisplay(sources) {
        return sources.map(s => {
            let displayLabel = s.objectName; 
            if (this.objectOptions.length) {
                const found = this.objectOptions.find(opt => opt.value === s.objectName);
                if (found) displayLabel = found.label;
            } else if (s.objectLabel) displayLabel = s.objectLabel;

            let active = s.hasOwnProperty('isActive') ? s.isActive : true;

            return {
                ...s,
                isActive: active,
                objectLabel: displayLabel,
                colorStyle: `display:block; width:24px; height:24px; border-radius:4px; background-color:${s.color}; border:1px solid #c9c7c5; opacity: ${active ? 1 : 0.4}`
            };
        });
    }

    refreshSourceLabels() {
        if (this.calendarSources.length) {
            this.calendarSources = this.processSourcesForDisplay(this.calendarSources);
        }
    }

    loadSettings() {
        const stored = localStorage.getItem('multi_cal_sources');
        let rawSources = [];
        if (stored) { try { rawSources = JSON.parse(stored); } catch(e) { rawSources = []; } }
        this.calendarSources = this.processSourcesForDisplay(rawSources);
        
        if (this.selectedCreationObject !== SELECT_AT_CREATION_KEY) {
            const exists = this.calendarSources.some(s => s.objectName === this.selectedCreationObject && s.isActive !== false);
            if (!exists) {
                this.selectedCreationObject = SELECT_AT_CREATION_KEY;
                localStorage.setItem('multi_cal_creation_obj', SELECT_AT_CREATION_KEY);
            }
        }
    }

    saveAllSettings() {
        const rawData = this.calendarSources.map(s => {
            let { colorStyle, ...rest } = s; 
            return rest;
        });
        localStorage.setItem('multi_cal_sources', JSON.stringify(rawData));
        localStorage.setItem('multi_cal_grid', this.colorGridHighlight);
        localStorage.setItem('multi_cal_today', this.colorToday);
        localStorage.setItem('multi_cal_max_records', this.maxRecordsPerDay);
        this.refreshCalendar();
        this.applyTheme();
        this.showToast('Success', 'Configuration Saved', 'success');
    }

    handleObjectChange(e) {
        let selectedApi = e.detail.value;
        let selectedOption = this.objectOptions.find(opt => opt.value === selectedApi);
        let src = { ...this.currentSource };
        src.objectName = selectedApi;
        src.objectLabel = selectedOption ? selectedOption.label : selectedApi; 
        src.startField = 'CreatedDate'; src.filters = [];
        this.currentSource = src;
        this.fetchMetadataForSource(src.objectName);
    }

    handleFormChange(e) {
        const field = e.target.dataset.field;
        let src = { ...this.currentSource };
        src[field] = e.detail.value;
        this.currentSource = src;
    }

    handleTitleTypeChange(e) {
        let src = { ...this.currentSource };
        src.titleType = e.detail.value;
        this.currentSource = src;
        getFlexibleTitleFields({ objectName: src.objectName }).then(res => {
             this.filteredTitleOptions = res.filter(f => f.type === src.titleType);
        });
    }

    addFilter() {
        if (this.currentSource.filters.length >= 5) return;
        let src = JSON.parse(JSON.stringify(this.currentSource));
        src.filters.push({ id: Date.now(), field: '', value: '', type: 'STRING', inputType: 'text' });
        this.currentSource = src;
    }

    removeFilter(event) {
        const index = parseInt(event.target.dataset.index, 10);
        let src = JSON.parse(JSON.stringify(this.currentSource));
        src.filters.splice(index, 1);
        this.currentSource = src;
    }

    handleFilterFieldChange(event) {
        const index = parseInt(event.target.dataset.index, 10);
        const fieldName = event.detail.value;
        const fieldMeta = this.allFieldsOptions.find(f => f.value === fieldName);
        let src = JSON.parse(JSON.stringify(this.currentSource));
        let filter = src.filters[index];
        filter.field = fieldName;
        filter.type = fieldMeta ? fieldMeta.type : 'STRING';
        if (filter.type === 'DATE' || filter.type === 'DATETIME') filter.inputType = 'date';
        else if (filter.type === 'BOOLEAN') filter.inputType = 'checkbox';
        else if (filter.type === 'DOUBLE' || filter.type === 'INTEGER' || filter.type === 'CURRENCY') filter.inputType = 'number';
        else filter.inputType = 'text';
        filter.value = ''; 
        this.currentSource = src;
    }

    handleFilterValueChange(event) {
        const index = parseInt(event.target.dataset.index, 10);
        const val = event.target.type === 'checkbox' ? event.target.checked : event.detail.value;
        let src = JSON.parse(JSON.stringify(this.currentSource));
        src.filters[index].value = val;
        this.currentSource = src;
    }

    async refreshCalendar() {
        if(!this.calendarSources.length) { this.rawEvents = []; this.renderView(); return; }
        
        const activeSources = this.calendarSources.filter(s => s.isActive !== false);

        const fetchPromises = activeSources.map(source => {
            const cleanFilters = source.filters ? source.filters.filter(f => f.field && f.value !== '') : [];
            const icon = OBJECT_ICONS[source.objectName] || 'standard:sobject';

            return getEvents({
                objectName: source.objectName,
                startField: source.startField || 'CreatedDate',
                endField: source.endField,
                userField: source.userField,
                titleField: source.titleField,
                filterJson: JSON.stringify(cleanFilters),
                filterLogic: source.filterLogic
            }).then(data => {
                return data.map(record => {
                    let title = (source.titleField && record[source.titleField]) ? record[source.titleField] : (record.Name || record.Id);
                    let startVal = record[source.startField || 'CreatedDate'];
                    if(!startVal) return null;
                    let startDt = new Date(startVal);
                    let endDt = (source.endField && record[source.endField]) ? new Date(record[source.endField]) : new Date(startDt);
                    if(endDt < startDt) endDt = new Date(startDt);

                    return { 
                        Id: record.Id, Title: title, Start: startDt, End: endDt,
                        Color: source.color, ObjectName: source.objectName,
                        style: `background-color: ${source.color};`,
                        iconName: icon
                    };
                }).filter(e => e !== null);
            }).catch(err => []);
        });

        try {
            const results = await Promise.all(fetchPromises);
            this.rawEvents = results.flat();
            this.renderView();
        } catch (error) { console.error(error); }
    }

    renderView() {
        this.isPopoverOpen = false; 
        if (this.currentView === 'month') this.generateMonthGrid();
        else if (this.currentView === 'week') this.generateWeekGrid();
        else if (this.currentView === 'day') this.generateDayGrid();
    }
    
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
            let allDayEvents = this.rawEvents.filter(e => this.isEventOnDate(e, currentDt));
            
            let isoDateStr = currentDt.getFullYear() + '-' + String(currentDt.getMonth() + 1).padStart(2, '0') + '-' + String(currentDt.getDate()).padStart(2, '0');
            let dayId = `curr-${i}`;
            
            const shownEvents = allDayEvents.slice(0, this.maxRecordsPerDay);
            const hiddenEvents = allDayEvents.slice(this.maxRecordsPerDay);
            const hasMore = hiddenEvents.length > 0;

            days.push({ 
                id: dayId, 
                class: isToday ? 'day current-month today' : 'day current-month', 
                label: i, 
                isoDate: isoDateStr, 
                events: shownEvents,
                hasMore: hasMore,
                moreCount: hiddenEvents.length,
                allEvents: allDayEvents,
                popoverDateLabel: currentDt.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
            });
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

    // FIXED: Correctly generate UTC ISO strings from local time slots
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
                let allSlotEvents = this.rawEvents.filter(e => this.isEventInSlot(e, dateObj, h));
                
                const shownEvents = allSlotEvents.slice(0, this.maxRecordsPerDay);
                const hiddenEvents = allSlotEvents.slice(this.maxRecordsPerDay);
                const hasMore = hiddenEvents.length > 0;
                let slotId = `slot-${h}-${index}`;

                // FIXED TIMEZONE LOGIC:
                // 1. Create date object for the specific day
                let createDt = new Date(dateObj);
                // 2. Set the hour based on the row index (h), and zero out minutes/seconds for clean slot time
                createDt.setHours(h, 0, 0, 0);
                // 3. Use built-in toISOString() to convert this specific LOCAL time to the correct UTC string
                let isoStr = createDt.toISOString();
                
                rowSlots.push({ 
                    id: slotId, 
                    class: isTodayCol ? 'week-slot today-column' : 'week-slot', 
                    isoDate: isoStr, 
                    events: shownEvents,
                    hasMore: hasMore,
                    moreCount: hiddenEvents.length,
                    allEvents: allSlotEvents,
                    popoverDateLabel: createDt.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
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

    handleGridClick(event) {
        if(event.target.closest('.event-chip') || event.target.closest('.event-chip-small') || event.target.closest('.show-more-link') || event.target.closest('.popover-container')) {
             return;
        }
        
        let dateStr = event.currentTarget.dataset.date;
        if(!dateStr) return;

        if (this.selectedCreationObject === SELECT_AT_CREATION_KEY) {
            this.clickedGridDate = dateStr;
            this.showCreationModal = true;
        } else {
            this.createRecord(this.selectedCreationObject, dateStr);
        }
    }

    // UPDATED: Async function to dynamically check field types before creation
    async createRecord(objectName, dateStr) {
        if (!objectName || !dateStr) return;

        let startField, endField;

        // 1. Determine field names (standard or config)
        if (DEFAULT_RECORD_FIELDS[objectName]) {
            startField = DEFAULT_RECORD_FIELDS[objectName].start;
            endField = DEFAULT_RECORD_FIELDS[objectName].end;
        } else {
            const sourceConfig = this.calendarSources.find(s => s.objectName === objectName);
            if (sourceConfig) {
                startField = sourceConfig.startField;
                endField = sourceConfig.endField;
            }
        }

        if (!startField || startField === 'CreatedDate' || startField === 'LastModifiedDate') {
            // If no valid start field, just open the form without defaults
            this[NavigationMixin.Navigate]({
                type: 'standard__objectPage', attributes: { objectApiName: objectName, actionName: 'new' }
            });
            return;
        }

        try {
            // 2. Fetch metadata dynamically to check field types
            const fieldMetaList = await getAllFields({ objectName });
            const startMeta = fieldMetaList.find(f => f.value === startField);
            const endMeta = endField ? fieldMetaList.find(f => f.value === endField) : null;

            let defaults = {};

            // Helper to format date based on metadata type vs input string format
            const formatDate = (meta, dStr) => {
                if (!meta || !dStr) return null;

                if (meta.type === 'DATETIME') {
                    if (dStr.includes('T')) {
                        // Case: DATETIME field & Week/Day view click (already has time) -> Use full string
                        return dStr;
                    } else {
                        // Case: DATETIME field & Month view click (no time) -> Append midnight UTC
                        return `${dStr}T00:00:00.000Z`;
                    }
                }
                
                // Case: DATE field -> Always ensure we only send YYYY-MM-DD
                return dStr.split('T')[0];
            };

            defaults[startField] = formatDate(startMeta, dateStr);
            if (endField) {
                defaults[endField] = formatDate(endMeta, dateStr);
            }
            
            // Clean up nulls
            Object.keys(defaults).forEach(key => defaults[key] === null && delete defaults[key]);

            // 3. Navigate
            this[NavigationMixin.Navigate]({ 
                type: 'standard__objectPage', 
                attributes: { objectApiName: objectName, actionName: 'new' }, 
                state: { defaultFieldValues: encodeDefaultFieldValues(defaults) } 
            });

        } catch (error) {
            console.error('Error fetching field metadata for creation:', error);
            // Fallback: open form without defaults if metadata fetch fails
            this[NavigationMixin.Navigate]({
                type: 'standard__objectPage', attributes: { objectApiName: objectName, actionName: 'new' }
            });
        }
    }

    handleCreationRadioChange(event) {
        const selectedValue = event.detail.value;
        this.selectedCreationObject = selectedValue;
        localStorage.setItem('multi_cal_creation_obj', selectedValue);
    }

    handleCreationModalSelect(event) {
        const objectName = event.currentTarget.dataset.value;
        this.showCreationModal = false; 
        if (this.clickedGridDate) {
            this.createRecord(objectName, this.clickedGridDate);
            this.clickedGridDate = null; 
        }
    }

    closeCreationModal() {
        this.showCreationModal = false;
        this.clickedGridDate = null;
    }

    handleEventClick(event) {
        event.stopPropagation();
        const recId = event.currentTarget.dataset.id;
        const evt = this.rawEvents.find(e => e.Id === recId);
        this[NavigationMixin.Navigate]({ type: 'standard__recordPage', attributes: { recordId: recId, objectApiName: evt ? evt.ObjectName : 'Event', actionName: 'view' } });
    }

    handleShowMoreClick(event) {
        event.stopPropagation();
        const dayId = event.currentTarget.dataset.dayid;
        let targetData;

        if (this.isMonthView) {
            targetData = this.monthDays.find(d => d.id === dayId);
        } else if (this.isWeekView) {
            for (const hour of this.hours) {
                targetData = hour.weekSlots.find(s => s.id === dayId);
                if (targetData) break;
            }
        } else if (this.isDayView) {
            targetData = this.hours.find(h => h.id === dayId);
        }

        if (targetData) {
            this.popoverLabel = targetData.popoverDateLabel;
            this.popoverEvents = targetData.allEvents;

            const cellElement = event.currentTarget.closest('.day, .week-slot, .day-slot');
            if (cellElement) {
                const rect = cellElement.getBoundingClientRect();
                let top = rect.top - 5;
                let left = rect.left - 5;

                if (this.isWeekView || this.isDayView) {
                    left = rect.right + 5;
                    top = rect.top - 10;
                }

                const popoverWidth = 260;
                if (left + popoverWidth > window.innerWidth) {
                    left = rect.left - popoverWidth - 5;
                }

                this.popoverStyle = `top: ${top}px; left: ${left}px;`;
                this.isPopoverOpen = true;
            }
        }
    }

    handleClosePopoverClick(event) {
        event.stopPropagation();
        this.isPopoverOpen = false;
    }

    handleThemeChange(e) { 
        this[e.target.dataset.id] = e.detail.value;
        if(e.target.dataset.id === 'maxRecordsPerDay') {
            this.renderView();
        }
    }
    
    resetTheme(e) { this[e.target.dataset.id] = this.defaultColors[e.target.dataset.key]; }
    
    applyTheme() {
        const container = this.template.querySelector('.main-container');
        if(container) {
            container.style.setProperty('--theme-today-bg', this.colorToday);
            container.style.setProperty('--theme-grid-hover', this.colorGridHighlight);
        }
    }

    openSettings() { this.isSettingsOpen = true; }
    closeSettings() { this.isSettingsOpen = false; this.cancelEdit(); }
    switchSettingsTab(e) { e.preventDefault(); this.currentSettingsTab = e.currentTarget.dataset.tab; }
    showToast(title, message, variant) { this.dispatchEvent(new ShowToastEvent({ title, message, variant })); }
    
    previous() { this.isPopoverOpen = false; this.changeDate(-1); }
    next() { this.isPopoverOpen = false; this.changeDate(1); }
    today() { this.isPopoverOpen = false; this.currentDate = new Date(); this.renderView(); }
    setView(e) { this.isPopoverOpen = false; this.currentView = e.target.value; this.renderView(); }
    
    changeDate(dir) {
        const dt = new Date(this.currentDate);
        if (this.currentView === 'month') dt.setMonth(dt.getMonth() + dir);
        else if (this.currentView === 'week') dt.setDate(dt.getDate() + (dir * 7));
        else dt.setDate(dt.getDate() + dir);
        this.currentDate = dt;
        this.renderView(); 
    }
}