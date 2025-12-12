public with sharing class CalendarWidgetController {

    @AuraEnabled(cacheable=true)
    public static List<Map<String, String>> getAllObjects() {
        List<Map<String, String>> objectList = new List<Map<String, String>>();
        Map<String, Schema.SObjectType> gd = Schema.getGlobalDescribe();
        for (String key : gd.keySet()) {
            Schema.DescribeSObjectResult describe = gd.get(key).getDescribe();
            if (describe.isQueryable() && describe.isAccessible() && 
                !describe.getName().contains('__Tag') && 
                !describe.getName().contains('__Share') && 
                !describe.getName().contains('__History') && 
                !describe.getName().contains('__Feed')) {
                objectList.add(new Map<String, String>{ 'label' => describe.getLabel(), 'value' => describe.getName() });
            }
        }
        return objectList;
    }

    // Returns ALL fields for the Filter Dropdown
    @AuraEnabled(cacheable=true)
    public static List<Map<String, String>> getAllFields(String objectName) {
        List<Map<String, String>> fieldList = new List<Map<String, String>>();
        if(String.isBlank(objectName)) return fieldList;
        SObjectType objType = Schema.getGlobalDescribe().get(objectName);
        if (objType == null) return fieldList;
        Map<String,Schema.SObjectField> mfields = objType.getDescribe().fields.getMap();
        
        for(String fieldName : mfields.keySet()){
            Schema.DescribeFieldResult f = mfields.get(fieldName).getDescribe();
            // Exclude complex types that are hard to filter via simple input
            if(f.getType() != Schema.DisplayType.ADDRESS && 
               f.getType() != Schema.DisplayType.BASE64 && 
               f.getType() != Schema.DisplayType.ENCRYPTEDSTRING) {
                
                 fieldList.add(new Map<String, String>{ 
                    'label' => f.getLabel(), 
                    'value' => f.getName(),
                    'type'  => String.valueOf(f.getType()) 
                 });
            }
        }
        return fieldList;
    }

    @AuraEnabled(cacheable=true)
    public static List<Map<String, String>> getDateFields(String objectName) {
        List<Map<String, String>> fieldList = new List<Map<String, String>>();
        if(String.isBlank(objectName)) return fieldList;
        fieldList.add(new Map<String, String>{ 'label' => 'Created Date', 'value' => 'CreatedDate' });
        fieldList.add(new Map<String, String>{ 'label' => 'Last Modified Date', 'value' => 'LastModifiedDate' });
        SObjectType objType = Schema.getGlobalDescribe().get(objectName);
        if (objType == null) return fieldList;
        Map<String,Schema.SObjectField> mfields = objType.getDescribe().fields.getMap();
        for(String fieldName : mfields.keySet()){
            Schema.DescribeFieldResult f = mfields.get(fieldName).getDescribe();
            if(fieldName.equalsIgnoreCase('CreatedDate') || fieldName.equalsIgnoreCase('LastModifiedDate')) continue;
            if(f.getType() == Schema.DisplayType.DATE || f.getType() == Schema.DisplayType.DATETIME){
                 fieldList.add(new Map<String, String>{ 'label' => f.getLabel(), 'value' => f.getName() });
            }
        }
        return fieldList;
    }

    @AuraEnabled(cacheable=true)
    public static List<Map<String, String>> getFlexibleTitleFields(String objectName) {
        List<Map<String, String>> fieldList = new List<Map<String, String>>();
        if(String.isBlank(objectName)) return fieldList;
        SObjectType objType = Schema.getGlobalDescribe().get(objectName);
        Map<String,Schema.SObjectField> mfields = objType.getDescribe().fields.getMap();
        for(String fieldName : mfields.keySet()){
            Schema.DescribeFieldResult f = mfields.get(fieldName).getDescribe();
            String dtype = String.valueOf(f.getType());
            if(f.getType() == Schema.DisplayType.STRING || f.getType() == Schema.DisplayType.PICKLIST || f.getType() == Schema.DisplayType.COMBOBOX || f.getType() == Schema.DisplayType.TEXTAREA || f.getType() == Schema.DisplayType.PHONE || f.getType() == Schema.DisplayType.EMAIL || f.getType() == Schema.DisplayType.URL || f.getType() == Schema.DisplayType.INTEGER || f.getType() == Schema.DisplayType.DOUBLE || f.getType() == Schema.DisplayType.ID) {
                 fieldList.add(new Map<String, String>{ 'label' => f.getLabel(), 'value' => f.getName(), 'type' => dtype });
            }
        }
        return fieldList;
    }

    @AuraEnabled(cacheable=true)
    public static List<Map<String, String>> getUserReferenceFields(String objectName) {
        List<Map<String, String>> fieldList = new List<Map<String, String>>();
        if(String.isBlank(objectName)) return fieldList;
        SObjectType objType = Schema.getGlobalDescribe().get(objectName);
        Map<String,Schema.SObjectField> mfields = objType.getDescribe().fields.getMap();
        for(String fieldName : mfields.keySet()){
            Schema.DescribeFieldResult f = mfields.get(fieldName).getDescribe();
            if(f.getType() == Schema.DisplayType.REFERENCE){
                for(Schema.sObjectType reference : f.getReferenceTo()) {
                    if(reference.getDescribe().getName() == 'User' || reference.getDescribe().getName() == 'Group') {
                        fieldList.add(new Map<String, String>{ 'label' => f.getLabel(), 'value' => f.getName() });
                        break; 
                    }
                }
            }
        }
        return fieldList;
    }

    @AuraEnabled
    public static List<SObject> getEvents(String objectName, String startField, String endField, String titleField, String filterJson) {
        if(String.isBlank(objectName)) return new List<SObject>();
        String actualStartField = String.isBlank(startField) ? 'CreatedDate' : startField;
        String actualTitleField = String.isBlank(titleField) ? 'Id' : titleField;

        String q = 'SELECT Id, ' + String.escapeSingleQuotes(actualStartField);
        if(String.isNotBlank(endField)) q += ', ' + String.escapeSingleQuotes(endField);
        if(!actualTitleField.equalsIgnoreCase('Id') && !actualTitleField.equalsIgnoreCase(actualStartField) && !actualTitleField.equalsIgnoreCase(endField)) {
             q += ', ' + String.escapeSingleQuotes(actualTitleField);
        }
                   
        q += ' FROM ' + String.escapeSingleQuotes(objectName);
        
        List<String> whereClauses = new List<String>();
        whereClauses.add(String.escapeSingleQuotes(actualStartField) + ' != NULL');

        // PROCESS DYNAMIC FILTERS
        if (String.isNotBlank(filterJson)) {
            try {
                List<Object> filters = (List<Object>) JSON.deserializeUntyped(filterJson);
                for (Object fObj : filters) {
                    Map<String, Object> fMap = (Map<String, Object>)fObj;
                    String fName = (String)fMap.get('field');
                    String fType = (String)fMap.get('type');
                    Object fVal = fMap.get('value');

                    if(String.isNotBlank(fName) && fVal != null && String.valueOf(fVal) != '') {
                        String cleanField = String.escapeSingleQuotes(fName);
                        
                        // Handle Types for Query Building
                        if(fType == 'BOOLEAN') {
                            whereClauses.add(cleanField + ' = ' + fVal);
                        } else if(fType == 'DOUBLE' || fType == 'INTEGER' || fType == 'CURRENCY' || fType == 'PERCENT') {
                             whereClauses.add(cleanField + ' = ' + fVal);
                        } else if(fType == 'DATE') {
                             whereClauses.add(cleanField + ' = ' + String.valueOf(fVal)); // Date comes as string YYYY-MM-DD
                        } else {
                             // Default to String logic
                             whereClauses.add(cleanField + ' = \'' + String.escapeSingleQuotes(String.valueOf(fVal)) + '\'');
                        }
                    }
                }
            } catch(Exception e) {
                System.debug('Filter Parsing Error: ' + e.getMessage());
            }
        }

        q += ' WHERE ' + String.join(whereClauses, ' AND ');
        q += ' ORDER BY ' + String.escapeSingleQuotes(actualStartField) + ' DESC LIMIT 2000'; 
        
        return Database.query(q);
    }
}