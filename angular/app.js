angular.module('app', [ 'ui.bootstrap', 'ui.bootstrap.tpls' ]);

angular.module('app').filter('orderResult', function() {
    return function(items, field) {
        var filtered = [];

        angular.forEach(items, function(item) {
            filtered.push(item);
        });

        filtered.sort(function (a, b) {
            return (a.attributes[field].value > b.attributes[field].value ? 1 : -1);
        });

        var high_is_good = filtered[0].attributes[field].highIsGood;

        if(high_is_good) {
            filtered.reverse();
        }

        return filtered;
    };
});

angular.module('app').controller('search_control', function($scope, $http) {
    $scope.results = [];
    $scope.headers = [];
    $scope.error = false;
    $scope.slot = -1;
    $scope.attributes;
    $scope.size = -1;

    $scope.slots = {
        11: 'Low',
        12: 'High',
        13: 'Med',
        2663: 'Rig'
    };

    $http.get('/attributes').success(function(data) {
        $scope.attributes = data;
    });

    $scope.search = function() {
        $http.get('/search?' + jQuery.param({
            min: $scope.min,
            max: $scope.max,
            attribute: $scope.attribute,
            slot: $scope.slot,
            size: $scope.size
        })).success(function(data) {
            $scope.error = false;
            $scope.results = data;
            console.log(data);
        }).error(function(err) {
            $scope.error = true;
        });
    };
});
