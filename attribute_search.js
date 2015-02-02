var pg = require('pg');
var q = require('q');
var parseXML = require('xml2js').parseString;
var http = require('http');
var querystring = require('querystring');
var express = require('express');
var app = express();

var do_query = function(query, params) {
    var promise = q.defer();

    pg.connect('postgres://node:imgay@localhost/eve', function(err, client, done) {
        if(err) {
            console.log(err);
            return;
        }

        var cb = function(err, result) {
            if(err || result.rows.length === 0) {
                promise.reject(err || new Error('No results.'));
            } else {
                promise.resolve(result.rows);
            }

            done();
        };

        client.query(query, params || cb, cb);
    });

    return promise.promise;
};

var do_market_api = function(type_ids) {
    var prices = {};

    var make_request = function(_type_ids) {
        var promise = q.defer();
        var type_ids_data = querystring.stringify({ typeid: _type_ids, regionlimit: 10000035 });

        var request = http.request({
            hostname: 'api.eve-central.com',
            path: '/api/marketstat',
            method: 'POST',
            headers: {
                'Content-Length': type_ids_data.length
            }
        }, function(res) {
            var data = '';

            res.on('data', function(chunk) {
                data += chunk;
            });

            res.on('end', function() {
                parseXML(data, function(err, result) {
                    var item;

                    for(var i=0; (item=result.evec_api.marketstat[0].type[i]); i++) {
                        prices[item['$'].id] = parseFloat(item.sell[0].avg[0]);
                    }

                    promise.resolve();
                })        
            });
        });

        request.write(type_ids_data + '\n'); 
        request.end();

        return promise.promise;
    };

    var promises = [], chunk=100;
    for(var i=0, j=type_ids.length; i<j; i+=chunk) {
        promises.push(make_request(type_ids.slice(i, i+chunk)));
    }

    var p = q.defer();

    q.allSettled(promises).then(function() {
        p.resolve(prices);
    });

    return p.promise;
};

app.set('views', __dirname + '/angular');
app.set('view engine', 'jade');

app.get('/', function(req, res) {
    res.render('index');    
});

app.get('/attributes', function(req, res) {
    do_query('select distinct "dgmAttributeTypes"."attributeID", "dgmAttributeTypes"."attributeName", "dgmAttributeTypes"."displayName", "dgmAttributeTypes"."description" from "invTypes" inner join "dgmTypeEffects" on ("dgmTypeEffects"."typeID"="invTypes"."typeID" and "dgmTypeEffects"."effectID" in (11, 12, 13, 2663)) inner join "dgmTypeAttributes" on ("dgmTypeAttributes"."typeID"="invTypes"."typeID" and coalesce("dgmTypeAttributes"."valueInt", "dgmTypeAttributes"."valueFloat") != 0) inner join "dgmAttributeTypes" on ("dgmAttributeTypes"."attributeID"="dgmTypeAttributes"."attributeID" and "dgmAttributeTypes"."published") where "invTypes"."published" order by "dgmAttributeTypes"."attributeName"', null).then(function(result) {
        var attributes = {};

        result.forEach(function(row) {
            if(!row.displayName) {
                return;
            }

            attributes[row.attributeName] = {
                display: row.displayName,
                description: row.description
            }
        });

        res.jsonp(attributes);
    }).catch(function(err) {
        console.log(err);

        res.status(500).jsonp({
            err: err
        });
    });
});

app.get('/search', function(req, res) {
    var attribute = req.query.attribute;
    var effects = [ 11, 12, 13, 2663 ];
    var sizes = [], size;
    var slots = [], slot;

    if(req.query.slot === undefined || req.query.slot < 0) {
        slots = effects;
    } else {
        for(var i=0; (slot=req.query.slot[i]); i++) {
            if(slot < 0 || slot >= effects.length || isNaN(parseInt(slot))) {
                continue;
            }

            slots.push(effects[parseInt(slot)]);
        }

        if(slots.length === 0) {
            res.status(500).jsonp({
                err: 'Invalid slots'
            });

            return;
        }
    }

    if(req.query.size !== undefined && req.query.size !== -1) {
        for(i=0; (size=req.query.size[i]); i++) {
            if(size > 4 || size < 1) {
                continue;
            }

            sizes.push(parseInt(size));
        }

        if(sizes.length === 0) {
            res.status(500).jsonp({
                err: 'Invalid size'
            });

            return;
        }
    }

    var types = [], type_ids = [];

    do_query('SELECT * FROM "invTypes" INNER JOIN "invGroups" USING ("groupID") INNER JOIN "dgmTypeAttributes" ON ("dgmTypeAttributes"."typeID"="invTypes"."typeID" AND "dgmTypeAttributes"."attributeID"=(SELECT "dgmAttributeTypes"."attributeID" FROM "dgmAttributeTypes" WHERE "dgmAttributeTypes"."attributeName"=$1::varchar)) INNER JOIN "dgmTypeEffects" ON ("dgmTypeEffects"."typeID"="invTypes"."typeID" AND "dgmTypeEffects"."effectID"=ANY($2::int[])) WHERE ("dgmTypeAttributes"."valueInt" IS NOT NULL OR "dgmTypeAttributes"."valueFloat" IS NOT NULL) AND "invTypes"."published"', [attribute, slots]).then(function(_types) {
        var type;

        for(i=0; (type=_types[i]); i++) {
            type.value = parseFloat(type.valueInt || type.valueFloat);
            type.valueInt = undefined;
            type.valueFloat = undefined;

            if(type.value === 0) {
                continue;
            }

            if(req.query.max && type.value > req.query.max) {
                continue;
            }

            if(req.query.min && type.value < req.query.min) {
                continue;
            }

            types.push(type);
            type_ids.push(type.typeID);
        }

        return do_query('SELECT * FROM "dgmTypeAttributes" INNER JOIN "dgmAttributeTypes" USING ("attributeID") WHERE "dgmTypeAttributes"."typeID"=ANY($1::int[])', [type_ids]);
    }).then(function(attributes) {
        var attribute;

        for(i=0; (attribute=attributes[i]); i++) {
            for(var j=0; (type=types[j]); j++) {
                if(type.typeID != attribute.typeID) {
                    continue
                }

                if(type.attributes === undefined) {
                    type.attributes = {};
                }

                attribute.value = parseFloat(attribute.valueInt || attribute.valueFloat);
                type.attributes[attribute.attributeName] = attribute;
                break;
            }
        }

        if(sizes.length > 0) {
            var tmp_types = [];

            for(i=0; (type=types[i]); i++) {
                var add = true;

                var attrs = Object.keys(type.attributes);
                for(j=0; (attribute=attrs[j]); j++) {
                    attribute = type.attributes[attribute];
                    if((attribute.attributeID === 128 || attribute.attributeID == 1547)
                      && sizes.indexOf(attribute.value) === -1) {
                        add = false;
                        break;
                    }
                }

                if(add) {
                    tmp_types.push(type);
                }
            }

            types = tmp_types;
        }
    }).then(function() {
        return do_market_api(type_ids);
    }).then(function(prices) {
        var type;
        for(var i=0; (type=types[i]); i++) {
            type.price = prices[type.typeID];
        }
    }).then(function() {
        res.jsonp(types);
    }).catch(function(err) {
        console.log(err);

        res.status(500).jsonp({
            err: err
        });
    });
});

app.use('/angular', express.static(__dirname + '/angular'));
app.use('/lib', express.static(__dirname + '/bower_components'));

app.listen(8181);
