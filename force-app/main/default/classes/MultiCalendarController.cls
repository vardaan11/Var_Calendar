public with sharing class MultiCalendarController {

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
                
                objectList.add(new Map<String, String>{ 
                    'label' => describe.getLabel(), 
                    'value' => describe.getName(),
                    'apiName' => describe.getName() // Explicit API Name for column
                });
            }
        }
        return objectList;
    }

    @AuraEnabled(cacheable=true)
    public static List<Map<String, String>> getAllFields(String objectName) {
        return getFieldData(objectName, null);
    }

    @AuraEnabled(cacheable=true)
    public static List<Map<String, String>> getDateFields(String objectName) {
        // System fields first
        List<Map<String, String>> fields = new List<Map<String, String>>();
        fields.add(new Map<String, String>{ 'label' => 'Created Date', 'value' => 'CreatedDate', 'type' => 'DATETIME' });
        fields.add(new Map<String, String>{ 'label' => 'Last Modified Date', 'value' => 'LastModifiedDate', 'type' => 'DATETIME' });
        
        // Append standard fields
        fields.addAll(getFieldData(objectName, new Set<String>{'DATE', 'DATETIME'}));
        return fields;
    }

    @AuraEnabled(cacheable=true)
    public static List<Map<String, String>> getFlexibleTitleFields(String objectName) {
        return getFieldData(objectName, new Set<String>{'STRING','PICKLIST','COMBOBOX','TEXTAREA','PHONE','EMAIL','URL','INTEGER','DOUBLE','ID'});
    }

    @AuraEnabled(cacheable=true)
    public static List<Map<String, String>> getUserReferenceFields(String objectName) {
        return getFieldData(objectName, new Set<String>{'REFERENCE'});
    }

    // Helper to fetch fields dynamically based on type
    private static List<Map<String, String>> getFieldData(String objectName, Set<String> validTypes) {
        List<Map<String, String>> fieldList = new List<Map<String, String>>();
        if(String.isBlank(objectName)) return fieldList;
        
        SObjectType objType = Schema.getGlobalDescribe().get(objectName);
        if (objType == null) return fieldList;
        
        Map<String,Schema.SObjectField> mfields = objType.getDescribe().fields.getMap();
        for(String fieldName : mfields.keySet()){
            Schema.DescribeFieldResult f = mfields.get(fieldName).getDescribe();
            String dtype = String.valueOf(f.getType());
            
            // Filter by type if provided
            if (validTypes == null || validTypes.contains(dtype)) {
                // Special check for Reference to ensure it points to User/Group
                if (dtype == 'REFERENCE' && validTypes != null) {
                    boolean isUserRef = false;
                    for(Schema.sObjectType ref : f.getReferenceTo()) {
                        if(ref.getDescribe().getName() == 'User' || ref.getDescribe().getName() == 'Group') {
                            isUserRef = true; break;
                        }
                    }
                    if(!isUserRef) continue;
                }

                fieldList.add(new Map<String, String>{ 
                    'label' => f.getLabel(), 
                    'value' => f.getName(), 
                    'type' => dtype 
                });
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
                        if(fType == 'BOOLEAN' || fType == 'DOUBLE' || fType == 'INTEGER' || fType == 'CURRENCY' || fType == 'PERCENT') {
                            whereClauses.add(cleanField + ' = ' + fVal);
                        } else if(fType == 'DATE') {
                             whereClauses.add(cleanField + ' = ' + String.valueOf(fVal)); 
                        } else {
                             whereClauses.add(cleanField + ' = \'' + String.escapeSingleQuotes(String.valueOf(fVal)) + '\'');
                        }
                    }
                }
            } catch(Exception e) { System.debug(e.getMessage()); }
        }

        q += ' WHERE ' + String.join(whereClauses, ' AND ');
        q += ' ORDER BY ' + String.escapeSingleQuotes(actualStartField) + ' DESC LIMIT 2000'; 
        return Database.query(q);
    }
}